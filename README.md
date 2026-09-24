# Rayzia Remote MCP

A remote HTTPS transport adapter for the official Rayzia MCP server.

It preserves the Rayzia editor-driving tool surface:
- get_catalog
- get_state
- run_verb
- draw
- run_command
- get_svg
- get_render
- wait_for_prompt
- reply_to_user

The browser side still drives the real Rayzia editor through
window.__skiavgW2.host. Only the transport is changed from local stdio/SSE
to HTTPS polling so the MCP endpoint can be deployed to Vercel.

## No plugin

No Figma plugin and no local Node MCP process are required.

Open the Rayzia editor at https://rayzia.com/vector, then paste public/bridge.js
into the DevTools console. The bridge polls this remote MCP for operations and
executes them in the actual Rayzia editor engine.

## Key

Custom MCP:
- Transport: HTTP
- URL: https://rayzia-remote-mcp-hyouka1.vercel.app/api/mcp
- Auth: No Auth

## Important limitation

Rayzia's original bridge is deliberately localhost-only and the official
editor's built-in AI connection is designed around the local transport.
This adapter changes that transport. Session/queue state is stored in the
Vercel function runtime, so this is intended for personal interactive use;
it is not a durable multi-user backend.

## Upstream

Based on RayziaOfficial/rayzia-mcp, MIT licensed.
