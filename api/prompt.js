import state from './_state.js';

export default function handler(req,res) {
  if (req.method !== 'POST') return res.status(405).json({error:'POST required'});
  let msg=req.body;
  if(typeof msg==='string'){try{msg=JSON.parse(msg)}catch{msg={}}}
  const text=String(msg?.text||'').slice(0,20000);
  if(!text.trim()) return res.status(400).json({error:'empty prompt'});
  if(state.promptWaiter){
    state.promptWaiter.finish({prompt:text,queued:state.promptQueue.length});
    return res.status(200).json({ok:true,delivered:true,queued:state.promptQueue.length});
  }
  state.promptQueue.push(text);
  return res.status(200).json({ok:true,delivered:false,queued:state.promptQueue.length});
}
