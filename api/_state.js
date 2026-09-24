const state = globalThis.__RAYZIA_REMOTE_MCP__ ??= {
  sessions: new Map(),
  opQueue: [],
  pending: new Map(),
  promptQueue: [],
  promptWaiter: null,
  bridgeConnected: false,
  bridgeLastSeen: 0,
  seq: 0
};
export default state;
