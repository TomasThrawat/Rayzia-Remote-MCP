import state from './_state.js';

export default function handler(req,res) {
  const connected = state.bridgeConnected && Date.now() - state.bridgeLastSeen < 10000;
  res.status(200).json({
    bridge: connected ? 'connected' : 'waiting',
    queuedOps: state.opQueue.length,
    pendingOps: state.pending.size,
    queuedPrompts: state.promptQueue.length,
    now: Date.now()
  });
}
