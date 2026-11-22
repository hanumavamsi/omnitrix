# P0 spike findings

## 1. Raw agent loop (2026-11-22) — done

Code: `spikes/01-agent-loop/` (loop written by hand, raw Gemini REST, one fake `get_weather` tool).

**What worked**

- The ReAct loop is small: ask the model, and if it returns `functionCall` parts, run them, send back one `user` turn of `functionResponse` parts in the same order, and repeat. If it returns only text, that text is the answer. A step cap (5) stops runaway loops.
- `gemini-flash-lite-latest` asked for **both cities in one turn** (2 parallel `functionCall`s). `Promise.all` ran them concurrently. The answer used the fake data (31°C / 29°C), so the model read the tool results rather than inventing weather.
- 3 Vitest tests against a scripted fake model cover direct answer, tool round trip and step cap. The loop depends only on the `CallModel` type, so it is testable with no network.

**Surprises**

- Real replies carry extra fields: `functionCall.id` and `thoughtSignature` (encrypted reasoning). Pushing the model's reply into history unchanged sends both back, which Gemini needs. Lesson: never rebuild the model's turn yourself.
- `functionResponse` without an `id` was accepted. Add the `id` once the AI SDK handles it.
- `gemini-flash-latest` returned **503 "high demand"**, then a retry hung the socket. The free tier is not reliable on its own.

**Decisions / follow-ups**

- Plumbing needs a retry on 503/429 with backoff (1s, 2s, 4s) plus a per-request timeout (30s). Both were added to the spike; the AI SDK has `maxRetries` built in.
- Add a **model fallback chain** (Flash → Flash Lite → other provider) when we move to the AI SDK (D3/D4). The single `OMNITRIX_MODEL` value becomes an ordered list.
- Outages strengthen D4's other path: a Claude Pro user drives Omnitrix from **their own Claude Code via the MCP server** (spike 6). That works for Act tasks. The in-app Look hotkey still needs an in-app model, so the fallback chain is still needed.
- Type-checking needs `@types/node`. Add it when `packages/agent` is set up.

## 2. Overlay per monitor (2026-11-22) — done

Code: `spikes/02-overlay/` (Electron 45.4.1). Laptop 1280×800 @150% + external 1920×1080 @100% (left, offset y=77): mixed DPI.

**What worked** (all checked by hand)

- One overlay window per display, created with that display's bounds and never moved. Corner ticks sit in the true corners on both screens, text is sharp, and `devicePixelRatio` matches each scale factor.
- `Ctrl+Shift+Space` shows the overlay on the monitor under the cursor with `showInactive()`, so focus stays in the user's app.
- Click-through (`setIgnoreMouseEvents(true)`), above everything (`setAlwaysOnTop(true, "screen-saver")`), and screenshots skip it (`setContentProtection(true)`).
- An unfocusable window can't get key events, so `Esc` is a global shortcut registered only while the overlay is visible. `Ctrl+Alt+Esc` quits.

**Surprises**

- Windows **clamps a new window to the work area** (screen minus taskbar, 48px short here). Fix: `win.setBounds(display.bounds)` right after creating it.
- The Electron binary didn't download during `npm i` the first time. Running `node node_modules/electron/install.js` fixed it. Watch for this on CI / fresh clones.

**Follow-ups**

- Rebuild the overlays on `display-added` / `display-removed` / `display-metrics-changed` (P1).
- Choose the overlay from the Omnitrix Chrome window's display instead of the cursor (after spike 5).
