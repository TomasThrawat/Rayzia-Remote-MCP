import state from './_state.js';

const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET,OPTIONS',
  'Access-Control-Allow-Headers':'content-type'
};

export default function handler(req,res) {
  for (const [k,v] of Object.entries(CORS)) res.setHeader(k,v);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({error:'GET required'}); return; }

  state.bridgeConnected = true;
  state.bridgeLastSeen = Date.now();

  const op = state.opQueue.shift();
  if (!op) {
    res.status(204).end();
    return;
  }

  res.status(200).setHeader('content-type','application/json; charset=utf-8').end(JSON.stringify(op));
}
