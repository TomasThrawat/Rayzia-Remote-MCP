import state from './_state.js';

const PROTOCOL_VERSION = '2024-11-05';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Expose-Headers': 'mcp-session-id'
};

const TOOLS = [
  {
    name: 'get_catalog',
    description: 'Discover everything the editor can do: semantic verbs (with param schemas), every raw command (typed where declared), effects, and tools. Call this FIRST.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_state',
    description: 'Read the current scene: selection, all objects (recursed into groups) with ids+bboxes+paint, active tool, document size, view. The observe half of the loop.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'run_verb',
    description: 'Run a high-level semantic verb: shapes, text (area / on-path / vertical / per-character), gradients, blends, warps, live path effects, filters, lock/hide, asset library, batch, and other editor verbs. Each semantic verb is one undo step.',
    inputSchema: {
      type: 'object',
      required: ['verb'],
      properties: {
        verb: { type: 'string' },
        args: { type: 'object' }
      }
    }
  },
  {
    name: 'draw',
    description: 'Draw with a real tool via synthetic input: drawPath with Pen points or freehand strokes. Supports modifier keys for shape-builder and mesh behaviors.',
    inputSchema: {
      type: 'object',
      required: ['verb'],
      properties: {
        verb: { type: 'string', enum: ['drawPath', 'freehand'] },
        args: { type: 'object' }
      }
    }
  },
  {
    name: 'run_command',
    description: 'Escape hatch for raw Rayzia engine commands. File/document operations remain deny-listed at the engine boundary.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        args: { type: 'array' }
      }
    }
  },
  {
    name: 'get_svg',
    description: 'Export the current document as a round-trip-safe SVG string.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_render',
    description: 'Render the canvas to a PNG so the model can inspect its own work after structural changes.',
    inputSchema: {
      type: 'object',
      properties: {
        maxEdge: { type: 'number', description: 'Longest image edge in px (default 1024).' }
      }
    }
  },
  {
    name: 'wait_for_prompt',
    description: 'Wait for text submitted to the Rayzia AI panel / prompt bridge. Times out normally; call again to keep listening.',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutSec: { type: 'number', description: 'Seconds to wait, capped at 55.' }
      }
    }
  },
  {
    name: 'reply_to_user',
    description: 'Send a short assistant message back to the Rayzia prompt bridge.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string' } }
    }
  }
];

const TOOL_BY_NAME = new Map(TOOLS.map(t => [t.name, t]));

function json(res, status, body, extra = {}) {
  res.status(status);
  for (const [k,v] of Object.entries(CORS)) res.setHeader(k,v);
  for (const [k,v] of Object.entries(extra)) res.setHeader(k,v);
  res.setHeader('content-type','application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sessionFor(id) {
  let s = state.sessions.get(id);
  if (!s) {
    s = { id, createdAt: Date.now() };
    state.sessions.set(id, s);
  }
  return s;
}

function waitForPrompt(timeoutMs) {
  if (state.promptQueue.length) {
    return Promise.resolve({
      prompt: state.promptQueue.shift(),
      queued: state.promptQueue.length
    });
  }
  return new Promise(resolve => {
    const waiter = { done:false };
    waiter.finish = payload => {
      if (waiter.done) return;
      waiter.done = true;
      if (state.promptWaiter === waiter) state.promptWaiter = null;
      clearTimeout(waiter.timer);
      resolve(payload);
    };
    waiter.timer = setTimeout(
      () => waiter.finish({
        prompt:null,
        timedOut:true,
        note:'no prompt within ' + Math.round(timeoutMs / 1000) + 's — call wait_for_prompt again'
      }),
      timeoutMs
    );
    if (state.promptWaiter) {
      state.promptWaiter.finish({
        prompt:null,
        timedOut:true,
        note:'superseded by a newer wait_for_prompt'
      });
    }
    state.promptWaiter = waiter;
  });
}

function queueOp(sessionId, op, timeoutMs) {
  const ms = timeoutMs || (op.kind === 'draw' || op.kind === 'render' ? 60000 : 30000);
  const reqId = 'op' + (++state.seq);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      state.pending.delete(reqId);
      resolve({ error:'bridge timeout' });
    }, ms);
    state.pending.set(reqId, { sessionId, resolve, timer });
    state.opQueue.push({
      reqId,
      sessionId,
      token: null,
      ...op,
      queuedAt: Date.now()
    });
  });
}

function makeToolOp(name, args) {
  if (name === 'get_catalog') return { kind:'catalog' };
  if (name === 'get_state') return { kind:'state' };
  if (name === 'run_verb') return { kind:'verb', verb:args.verb, args:args.args || {} };
  if (name === 'draw') return { kind:'draw', verb:args.verb, args:args.args || {} };
  if (name === 'run_command') return { kind:'command', name:args.name, args:args.args || [] };
  if (name === 'get_svg') return { kind:'svg' };
  if (name === 'get_render') return { kind:'render', maxEdge:args.maxEdge || 1024 };
  if (name === 'reply_to_user') return { kind:'panelReply', text:String(args.text || '').slice(0,8000) };
  return null;
}

export default async function handler(req,res) {
  if (req.method === 'OPTIONS') {
    res.status(204);
    for (const [k,v] of Object.entries(CORS)) res.setHeader(k,v);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    json(res,405,{error:'POST required'});
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { json(res,400,{error:'Invalid JSON'}); return; }
  }

  const method = body?.method;
  const id = body?.id ?? null;
  let sessionId = req.headers['mcp-session-id'];
  if (Array.isArray(sessionId)) sessionId = sessionId[0];

  if (method === 'initialize') {
    sessionId = globalThis.crypto?.randomUUID?.() || ('r-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    sessionFor(sessionId);
    json(res,200,{
      jsonrpc:'2.0',
      id,
      result:{
        protocolVersion:PROTOCOL_VERSION,
        capabilities:{tools:{}},
        serverInfo:{name:'rayzia-remote',version:'0.3.0'}
      }
    },{'mcp-session-id':sessionId,'mcp-protocol-version':PROTOCOL_VERSION});
    return;
  }

  if (!sessionId) {
    json(res,400,{jsonrpc:'2.0',id,error:{code:-32000,message:'MCP session required'}});
    return;
  }

  sessionFor(sessionId);

  if (method === 'notifications/initialized' || String(method || '').startsWith('notifications/')) {
    res.status(202);
    for (const [k,v] of Object.entries(CORS)) res.setHeader(k,v);
    res.end();
    return;
  }

  if (method === 'ping') {
    json(res,200,{jsonrpc:'2.0',id,result:{}},{'mcp-session-id':sessionId});
    return;
  }

  if (method === 'tools/list') {
    json(res,200,{jsonrpc:'2.0',id,result:{tools:TOOLS}},{'mcp-session-id':sessionId});
    return;
  }

  if (method === 'tools/call') {
    const name = body?.params?.name;
    const args = body?.params?.arguments || {};
    const t = TOOL_BY_NAME.get(name);
    if (!t) {
      json(res,200,{jsonrpc:'2.0',id,error:{code:-32602,message:'unknown tool '+name}},{'mcp-session-id':sessionId});
      return;
    }

    if (name === 'wait_for_prompt') {
      const result = await waitForPrompt(Math.min(55000, Math.max(1000,(Number(args.timeoutSec) || 25) * 1000)));
      json(res,200,{
        jsonrpc:'2.0',
        id,
        result:{content:[{type:'text',text:JSON.stringify(result,null,2)}],isError:false}
      },{'mcp-session-id':sessionId});
      return;
    }

    const op = makeToolOp(name,args);
    const result = await queueOp(sessionId,op);
    if (!result || result.error) {
      json(res,200,{
        jsonrpc:'2.0',
        id,
        result:{
          content:[{type:'text',text:JSON.stringify(result || {error:'empty result'},null,2)}],
          isError:true
        }
      },{'mcp-session-id':sessionId});
      return;
    }

    if (result.image) {
      json(res,200,{
        jsonrpc:'2.0',
        id,
        result:{
          content:[
            {type:'image',data:result.image,mimeType:'image/png'},
            {type:'text',text:'rendered '+result.w+'x'+result.h}
          ],
          isError:false
        }
      },{'mcp-session-id':sessionId});
      return;
    }

    json(res,200,{
      jsonrpc:'2.0',
      id,
      result:{
        content:[{type:'text',text:JSON.stringify(result,null,2)}],
        isError:false
      }
    },{'mcp-session-id':sessionId});
    return;
  }

  json(res,200,{jsonrpc:'2.0',id,error:{code:-32601,message:'method not found: '+method}},{'mcp-session-id':sessionId});
}
