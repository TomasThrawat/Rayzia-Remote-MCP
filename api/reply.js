import state from './_state.js';

const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'content-type'
};

export default function handler(req,res) {
  for (const [k,v] of Object.entries(CORS)) res.setHeader(k,v);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({error:'POST required'}); return; }

  let msg = req.body;
  if (typeof msg === 'string') {
    try { msg = JSON.parse(msg); } catch { msg = {}; }
  }

  const reqId = String(msg?.reqId || '');
  const pending = state.pending.get(reqId);
  if (!pending) {
    res.status(404).json({error:'pending request not found'});
    return;
  }

  clearTimeout(pending.timer);
  state.pending.delete(reqId);
  pending.resolve(msg || {error:'empty reply'});

  res.status(200).json({ok:true});
}
