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

## 3. Selection grab (2026-11-22) — done

Code: `spikes/03-selection/main.js` (Electron 45 + `koffi` for user32). Tested by an automated sub-agent (fake keys + screenshots).

| Case | Result |
| --- | --- |
| Notepad, text selected | grabbed, clipboard restored, about 47ms copy |
| Notepad, nothing selected | `NONE`, clipboard untouched |
| Chrome web page | grabbed, DevTools did **not** open (the wait-for-release works) |
| Chrome PDF viewer | grabbed (needs focus inside the document) |
| Copied files on clipboard | file drop list survived the restore |
| VS Code, text selected (re-tested 2026-11-23) | grabbed, clipboard restored, about 47ms copy |
| VS Code, nothing selected | **returns the whole current line plus CRLF**, so it can't be told apart from a real selection |

**Surprises**

- **Electron 45 clipboard is async and W3C-style**: only `read/write/readText/writeText/has/clear`. `readImage/readHTML/readRTF` are gone. Snapshot = `await clipboard.read()` plus eager `getType()` for each type; restore = `clipboard.write(items)`.
- The hotkey's Ctrl+Shift are still held when it fires. Sending Ctrl+C right away becomes Ctrl+Shift+C (Chrome DevTools inspect). Waiting for release (about 107ms in tests) fixes it.
- Windows timers tick about every 15.6ms. A `50 × sleep(10)` loop took about 830ms, not 500ms. Use deadlines (`performance.now()`), not loop counts. Fixed.
- If the target app is in menu or KeyTips mode (a bare Alt press in Win11 Notepad), our Ctrl+C is swallowed and the result reads `NONE`.
- `restoredOk` compares plain text only. Only some formats are captured (Electron exposes a subset). Rich or app-private clipboards may degrade.

**Follow-ups**

- VS Code (and other editors) copy the whole line when nothing is selected. Detecting "no selection" needs UIA `TextPattern.GetSelection()` first, with Ctrl+C only as the fallback (P1).
- Our temporary clipboard entry likely shows up in Win+V history (unchecked).

## 4. Region capture + Gemini vision (2026-11-23) — done

Code: `spikes/04-region/` (Electron 45, `desktopCapturer` in main, raw Gemini REST with `inline_data` PNG). Model `gemini-flash-lite-latest`. Tested by an automated sub-agent on both monitors (150% laptop, 100% external).

| Measure | Result |
| --- | --- |
| Crop alignment | pixel-exact on both monitors (0,0 offset). On 150% the edges snap to the 1.5px grid, so at most 1px off |
| Dim layer in crop | none: `setContentProtection(true)` keeps our overlay out of our own capture, so there's no need to hide it first |
| Capture | about 240ms median (237–348). Most of it is `desktopCapturer` grabbing every screen at full size |
| Gemini | 1.2–2.3s typical, one 5.7s outlier. No 429/503 in about 12 calls |
| Tokens | **about 1,090 per image whatever its size** (90×45 → 1087, 1860×1070 → 1112). PNG size 1–144 KB |
| Answers | all correct (code text, table/chart max, a single word). The default "explain" prompt skips details. A pointed question gets them |

**Surprises**

- **Image cost is flat**: a tiny crop costs the same as a big one, so don't downscale to save tokens. Downscaling only saves upload bytes.
- **Our HUD is invisible to every screenshot tool**, including the tester's GDI capture. That's good for privacy, but users can't screenshot an answer panel to share it, and automated tests can't see it. Panel rendering needs a human eye (or turning protection off in test builds).
- **Hiding a focused window doesn't hand focus back** on Windows. Focus stayed on the hidden overlay. Fix: save `GetForegroundWindow()` on the hotkey and call `SetForegroundWindow` on hide (koffi). When switching monitors, hide the overlays without clearing the saved window.

**Follow-ups**

- Capture only the target display (or use `getUserMedia` with one source) if 240ms becomes a problem. It's small next to the model's 1.5s.
- Stream the answer (`streamGenerateContent`) so the first words appear in under 1s.
- Free tier: about 1.1k tokens per Look, so the limit is requests per minute/day, not tokens. Check the RPD for Flash Lite when picking the default.

**Second test round (2026-11-23), bugs found and fixed**

- **Panel ran off the screen** with a long answer when the box was low. It now goes on the side with more room, and `max-height` is capped to that room.
- **A stale answer overwrote the new one** (hotkey pressed again while a request was in flight). There's now a request counter in the renderer, and late replies are dropped. The real app should also abort the request (`AbortController`).
- **Focus got stuck if the app you came from closed** while the overlay was open, and our own hidden overlay was then saved as the window to return to. Fix: `IsWindow` before restoring, and skip windows whose PID is ours.
- **Drag past the monitor edge**: the rect is now clamped in the overlay. The crop was already right, but the log and the box were wrong. Minor quirk: when dragging from the 100% monitor onto the 150% one, the edge that follows the cursor lags (mixed-DPI mouse coordinates). Low impact.
- The default prompt on a table names only the rows and columns, not the numbers. A specific question works.
- Markdown shows as raw text (`###`, `**`). The real panel needs a markdown renderer (D14).
- Errors show raw Gemini JSON. The real app should map them to short messages.

**Not handled:** a box nearly the full screen height leaves no room for the panel. In the real app, the panel should then sit inside the box.

**Testing note:** Win11 Notepad shares one process across windows, so the tester must never kill Notepad (by name or PID). Test apps are now the tester's own PowerShell WinForms windows.

## 5. Playwright + dedicated Chrome profile (2026-11-23) — done, D2 needs a rethink

Code: `spikes/05-browser/main.js` (Electron main + `playwright-core@1.65.0`, `channel: "chrome"` = installed Chrome 158, profile `%LOCALAPPDATA%\omnitrix-spike5\chrome-profile`). Tested by the automated sub-agent: the spike run on both monitors, plus one real user flow per site at human pace with default launch args (no stealth tweaks).

| Site | Loads | Real flow | Notes |
| --- | --- | --- | --- |
| Google Flights | yes | **PASS**: HYD→DEL one-way, results 1s after Search | Origin field opens a "Where else?" multi-select popup |
| YouTube | yes | **PASS**: search "lofi", first video plays (ad, then stream) | Empty profile, so the home page is "Try searching" |
| Air India | yes | **FAIL, silent**: results page stays empty | `net::ERR_FAILED https://api.airindia.com/cbiz-booking/v2/prime/auth/token` |
| IndiGo | widget missing | **FAIL, escalating**: by the 4th visit the home page itself fails | `net::ERR_HTTP2_PROTOCOL_ERROR`, plus a `403` on `api-6eskypulse.goindigo.in/ingest/v1/web/start` |

No CAPTCHA or block page anywhere: the airlines fail quietly at the network level. `navigator.webdriver` is `true`. **A control run in plain Chrome (no Playwright, fresh profile, same network) loaded IndiGo fine**, so the block is triggered by automation, not by the IP.

**Snapshot size** (`page.ariaSnapshot({ mode: "ai" })`, with refs; tokens ≈ chars/4)

| Page | chars | refs | ≈ tokens |
| --- | --- | --- | --- |
| YouTube home / results | 5.7k / 50.8k | 82 / 592 | 1.4k / 12.7k |
| Google Flights home / results | 16.3k / 49.7k | 214 / 568 | 4k / 12.4k |
| IndiGo home | 33.9k | 351 | 8.5k |
| Air India home / with calendar open | 44.9k / 151k | 603 / 1953 | 11k / **38k** |

Results pages run about 12k tokens. Calendars blow up the snapshot, so it needs scoping to a region or pruning.

**Ghost cursor mapping: solved.** Viewport origin = `screenX + (outerWidth−innerWidth)/2`, `screenY + (outerHeight−innerHeight−border)`. Chrome's screen coordinates are the same DIP space as Electron's `screen` (mixed DPI included), so `screen.dipToScreenPoint()` gives physical pixels. The real cursor lands **≤1 CSS px** from the element centre on both monitors. The exact origin is also available from any mousemove (`screenX − clientX`).

**Surprises**

- The airlines block silently and get worse with repeat visits, and IndiGo seems to remember the profile. An agent sees a "loaded" page with an empty widget, so we need an "expected element never appeared" check, not just a CAPTCHA check.
- `Browser.setWindowBounds` sizes come out ×1.5 on the 150% monitor and ÷1.5 on the 100% one, so the units look tied to the wrong monitor's DPI. Don't place windows through CDP. Unresolved.
- Playwright's defaults show Chrome's "unsupported command-line flag: --no-sandbox" bar.
- Spike bug: the target picker matched elements outside the viewport (3/8 null rows). The real tools must check the box lies inside the viewport, and scroll into view first.
- Screenshots catch the overlay mid show-animation (about 2% zoom, 16px off). Keep the overlay shown and move only the dot.
- Air India's a11y bug: its destination field is labelled "Select origin airport". It also auto-advances From → To → calendar.

**Decision needed (for the grill)**

- D2 flight hero: Google Flights works for search and compare. Booking on IndiGo / Air India through Playwright is blocked. Options: (a) Look/compare on Google Flights, then hand off to the airline in the user's own browser for booking; (b) drive a normally launched Chrome via `connectOverCDP` instead of Playwright's launch (untested; it changes the detection surface, so check the sites' terms first); (c) a different booking site. YouTube (the first Act demo, D1) is fine as is.

### 5b. Playwright attached over CDP (2026-11-23): airlines work

The app starts Chrome itself with only `--remote-debugging-port=9333 --user-data-dir=<new profile> --no-first-run`, then calls `chromium.connectOverCDP("http://127.0.0.1:9333")` and uses the default page. Same human-paced flows, no stealth changes.

| Flow | Result | `webdriver` |
| --- | --- | --- |
| IndiGo HYD→DEL | **PASS**: results page shows about 105 flights, from ₹8,719 | false |
| Air India, same trip | **PASS**: 20 flights, from INR 9,185. The auth token call now succeeds. | false |
| Google Flights (control) | **PASS**: 888 ms | false |

- IndiGo's `403` on `api-6eskypulse.../ingest/v1/web/start` happens on every visit, even when the page works, so it's telemetry rather than a block.
- Not isolated: which signal made the difference. Playwright's launch flags, `webdriver`, or the fresh profile could each explain it.
- Tested once per site from this IP. Repeated visits are untested.
- Air India's desktop layout (larger window) uses dropdown `option`s where the narrow layout uses modal buttons, so the agent can't rely on one fixed layout.
- **Snapshot size on results pages**: IndiGo is 187k chars, 2,822 refs (about 47k tokens); Air India is 68k chars; Google Flights is 64k chars. These are much bigger than first measured, so scoping is mandatory.
