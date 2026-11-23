# Showcase 1: Look

> **Demo:** _recording link goes here_ (recorded with Recordable on)

Point at something on screen, press **Ctrl+Shift+Space**, and get a short answer in a see-through HUD panel beside it. Ask follow-ups in the panel without leaving what you were doing.

## What it does

- **Explain a selection.** Select text in any app (code, a term, a formula, a table, a foreign sentence) and press the hotkey. The answer is 2–4 sentences, shaped by what the text is: what code does, a definition, a worked result, the key numbers in a table, a translation.
- **Ask about a region.** Press the hotkey with nothing selected. The screen dims. You can type a question first or after, then drag a box. The answer can see the image.
- **Follow up.** The panel keeps the conversation, including the image, until it is closed. A new hotkey press starts fresh.
- **Stays out of the way.** The panel sits on the side of the cursor or box that has more room, never over the taskbar (or at a fixed right edge if you prefer). Everything outside it is click-through, and Esc or ✕ hands focus back to the app you came from.
- **Safe by default.**
  - Obvious secrets (`API_KEY=…`, `AIza…` keys, JWTs, private keys) are replaced before anything leaves the machine. The panel says how many.
  - The HUD is hidden from screenshots and screen shares unless Recordable is on.
- **Console** (tray icon):
  - Settings.
  - The API key, stored encrypted with Windows DPAPI.
  - Read-only history of past Looks, with redacted text and small thumbnails only.
- **Traces.** Every Look writes a JSONL line with the model, latency, tokens, capture size, retries, fallback and errors. Content is included only when you opt in.

## How it works

```
hotkey ─► grab selection (clipboard round-trip) ─┬─ text ──────────────┐
                                                 └─ none ─► region picker ─► crop PNG ┤
                                                                                      ▼
                     HUD panel ◄── stream ◄── look() ◄── redact() ◄── capture + conversation
                         │                      │
                    follow-up ──────────────────┘   main model ─(busy / limit / offline)─► fallback model
```

- **`apps/desktop`** is Electron. It has:
  - the hotkey;
  - the selection grab (simulated Ctrl+C with the clipboard restored, via koffi user32 calls);
  - one click-through HUD window per monitor, created on its own display and never moved, because mixed DPI rescales badly;
  - the region crop, the Console, history and traces.
- **`packages/agent`** holds `look()`. It is a thin wrapper over the Vercel AI SDK `streamText` that:
  - redacts the capture and the user turns before the call;
  - turns every failure into one of a few error kinds the HUD can explain in plain words;
  - switches to the fallback model only when a different model could help (busy, rate or daily limit, network), and only if no text has streamed yet.
- **The panel** renders markdown and KaTeX math, sanitized with DOMPurify. Links can't navigate the HUD.
- **The system prompt** was tuned on 7 sample captures; see `docs/look-prompt-results.md`.

## Lessons learned

- **Windows hides the taskbar for a topmost window that exactly covers a monitor.** It treats it as a fullscreen app. The HUD is 1px short of the screen for that reason.
- **The AI SDK's `textStream` swallows errors.** Look reads the full stream and rethrows, or a failed call just looks like an empty answer.
- **Gemini signals blocked content as a normal finish** (`content-filter`), not as an error. The daily free quota and the per-minute limit are both HTTP 429; only the response body tells them apart.
- **Flash returned 503 often during development, while Flash Lite worked.** So Lite is the default Look model, and Flash is the fallback.
- **Crop coordinates must be in physical pixels per monitor.** A 150% and a 100% monitor side by side is the case that breaks naive math.
- **Hide the dim layer and wait two frames before capturing**, or the picker ends up in the crop.
- **Protected windows (for example a Citrix session) capture as black.** The model honestly says "the image is black". Look doesn't detect this yet.
- **Redaction is pattern-based.** It catches config lines and known key shapes, but not a lower-case `password=x` mid-sentence or short free-form secrets. That is good enough for P1 and noted in the code.
- **Windows git with `core.autocrlf` breaks the formatter.** `.gitattributes` with `eol=lf` fixed it for good.

## Limits

- Text and screen regions only. Voice and Act come in later phases.
- The History view is read-only. You can't resume a conversation, and the tab refreshes when you re-open it.
- Google Gemini is the only provider wired up so far.
