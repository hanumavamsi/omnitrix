# Omnitrix — Plan

Codename `omnitrix` (Ben 10 trademark → pick public name before wide release, see D15).
Status: grilled and agreed 2026-11-22; re-grilled after spikes 1–5 on 2026-11-23 (D2, D4, D6, D13, D14); P1 grilled 2026-11-23 (L1–L15). All 6 spikes finish before P1. Later phases get their own short grill when we reach them.

## Goals (ranked)

1. Learn AI agent engineering end-to-end (agent loop, guardrails, MCP, memory, evals, observability).
2. Resume piece: working demo + write-ups.
3. Daily-use tool.
4. Open source (MIT), usable by others.

## What it is

A Windows desktop assistant with a transparent neon-green (`#00ff66`) on matte-black HUD.
Two halves:

- **Look** — understand what's on screen (selected text, a dragged region) and explain it in a HUD panel.
- **Act** — do things in the browser (later: desktop apps) with a visible ghost cursor and safety gates.

## Architecture

```
Ctrl+Shift+Space
   │
apps/desktop (Electron)
   ├─ HUD: one overlay window per monitor, only the agent's monitor visible
   ├─ input screen: selection → explain | dim + type command / drag region
   ├─ Console window (tray): settings + history
   ├─ hosts ─► packages/agent  (Vercel AI SDK; look() = streaming call, no tools; Act loop in P2)
   │                │ MCP client
   │                ▼
   └─ hosts ─► packages/mcp-server  (Streamable HTTP on 127.0.0.1, bearer token, Origin check, one-task lock)
                    ├─ browser tools: Playwright connectOverCDP to self-launched Chrome (dedicated profile), ariaSnapshot
                    ├─ safety tiers (enforced here, for every client)
                    └─ {{profile.*}} placeholder substitution
External MCP clients (Claude Code, Cursor, Gemini CLI) can use the same server.
```

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Build order: **Look first**, then **Act** (YouTube, then flight). Browser before Windows desktop automation.                                                                                                                                                                                                                                  |
| D2  | **Showcases** (not one hero): 3 tasks, each proves a different capability, each gets a recorded demo + write-up. (1) Look: select text → instant explain (no screenshot) **and** drag a region → ask about it; follow-ups in the HUD panel. (2) Act single-site: YouTube last watched. (3) Act multi-site: compare (Google Flights) → book on IndiGo/Air India → **hard stop at payment**; doubles as the MCP showcase (same tools from an external client). Details of (3) deferred to the P2 grill. |
| D3  | Hand-written raw agent loop once (spike 1, learning), then **Vercel AI SDK** (`ai` + direct provider packages, no AI Gateway).                                                                                                                                                                                                                |
| D4  | LLM-agnostic. Default **Gemini Flash**; two config values: `OMNITRIX_LOOK_MODEL` (default `google:gemini-flash-lite-latest`, fast, spike 4) and `OMNITRIX_ACT_MODEL` (default `google:gemini-flash-latest`, multi-step over big snapshots); any provider in either. No Claude subscription login inside the app (Anthropic terms) — Pro users can use the MCP server from Claude Code instead.                                                                                               |
| D5  | Core = **MCP server hosted in Electron**, Streamable HTTP on `127.0.0.1`, random bearer token (generated first run), Origin header check, one task at a time.                                                                                                                                                                                 |
| D6  | Browser: our app **starts Chrome itself** (dedicated profile `--user-data-dir`, random `--remote-debugging-port` on 127.0.0.1) and **Playwright attaches with `connectOverCDP`**. Playwright-launched Chrome is blocked by IndiGo/Air India; the attached one is not (spike 5b, ADR-0001). Our own tools wrap Playwright (click/type go through ghost cursor + safety gate). If the page part the agent expects never appears, stop and hand over to the user, no retry loops. |
| D7  | Safety tiers enforced in server code. **Auto**: open URL, snapshot, scroll, search boxes, filters. **Confirm** (Enter/Esc on HUD): personal details, select fare, continue/book/proceed. **Never**: card/UPI/CVV/OTP/password fields, CAPTCHA, Pay. Unclear → Confirm. Kill switch `Ctrl+Alt+Esc`. Page text is untrusted (prompt injection). |
| D8  | Personal data in `%APPDATA%\omnitrix\profile.json` (never in repo); model uses `{{profile.x}}` placeholders, server substitutes at type time. Later → memory DB.                                                                                                                                                                              |
| D9  | English only.                                                                                                                                                                                                                                                                                                                                 |
| D10 | MIT license.                                                                                                                                                                                                                                                                                                                                  |
| D11 | Monorepo, **npm workspaces**: `apps/desktop`, `packages/mcp-server` (no Electron dependency), `packages/agent`. electron-vite, strict TS, plain CSS HUD, Vitest, Biome. No `shared/` until needed.                                                                                                                                            |
| D12 | Observability: JSONL traces per task in `%APPDATA%\omnitrix\traces\` now; OpenTelemetry → Langfuse (or Phoenix) later.                                                                                                                                                                                                                        |
| D13 | HUD: one overlay per monitor (created on its own display, never moved), show only the one containing the Omnitrix Chrome window. Click-through, always-on-top. **Recordable** setting is ON by default (owner feedback 2026-11-24, P1.1): no content protection, so screenshots, OBS, Game Bar and test screenshots see the HUD, and region capture hides the overlay one frame before grabbing. Turning it off sets `setContentProtection(true)`, hiding the HUD from screen capture.                                                                                                                                                  |
| D14 | `Ctrl+Shift+Space`: selection present → grab via simulated Ctrl+C + clipboard restore → explain panel with follow-ups. No selection → dim screen + command box: type = command/question, drag = region capture (+ optional question). Answers render markdown + KaTeX. Esc cancels. Capture only on explicit user trigger. Known limit (accepted): editors that copy the current line on empty Ctrl+C (VS Code) look like a selection.                    |
| D15 | Each hotkey press = fresh conversation (follow-ups inside open panel keep context). Upgrade later: continue if within ~5 min (time-bound memory).                                                                                                                                                                                             |
| D16 | Public GitHub repo now under codename; rename before wide release (GitHub redirects).                                                                                                                                                                                                                                                         |
| D17 | Secrets: `.gitignore` first, gitleaks pre-commit hook, GitHub secret scanning + push protection, API key stored with Electron `safeStorage` (DPAPI) via settings box, env var override for dev. Only `*.example` files in repo.                                                                                                               |
| D18 | Code split: user writes learning parts (raw loop, safety tiers, placeholders, memory, evals) from skeleton + test + hints; Claude writes plumbing and explains. TS taught via Java analogies. Waived for P1 redaction + Look system prompt (agent writes them).                                                                                                                                                 |
| D19 | Inspiration: [Roamies](https://github.com/KenKaiii/Roamies) — **AGPL-3.0, read for ideas only, copy no code.**                                                                                                                                                                                                                                |
| D20 | Shell: **Electron now; Tauri (+ Node sidecar) later only if RAM hurts.** Kept cheap because `mcp-server` and `agent` have no Electron dependency — a switch rewrites only `apps/desktop`.                                                                                                                                                     |

## Phases

| Phase                 | Deliverable                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 Spikes**         | 6 throwaway scripts in `spikes/`, findings in `docs/spikes.md` (below).                                                                |
| **P1 Look**           | Hotkey → explain selection / dragged region in HUD panel, follow-ups. Console (settings + history). JSONL traces. Showcase 1. See L1–L15. |
| **P2 Act**            | Browser tools + ghost cursor + safety tiers. "Open my YouTube, play last watched video", then flight hero to payment stop.             |
| P3 Voice              | Push-to-talk → VAD → STT → agent → streaming TTS, barge-in. Spike: Whisper vs **NVIDIA Parakeet TDT 0.6B ONNX**.                       |
| P4 Draw mode          | HUD captures pen input, "what animal is this?".                                                                                        |
| P5 Memory             | Episodic log, semantic facts (sqlite-vec + FTS5 hybrid), procedural skills, time-bound continuation (D15 upgrade). Profile moves here. |
| P6 Evals              | Offline replay of recorded tasks, online success/correction logging.                                                                   |
| P7 Desktop automation | Windows UI Automation backend; **Windows built-in OCR** for cheap text grounding; WhatsApp share.                                      |
| P8 Extras             | Wake word, full-screen diagrams, RAM/CPU + token watchdog, OpenTelemetry/Langfuse.                                                     |

## P1 Look decisions (grilled 2026-11-23)

| #   | Decision |
| --- | -------- |
| L1  | In-app Look passes the capture (text or region PNG) straight into the first model message. |
| L2  | **No look tools on the MCP server.** MCP is the Act surface for external clients. P1 doesn't touch `packages/mcp-server`, and Look has no tools. |
| L3  | `packages/agent` exports a streaming `look(conversation)`. Desktop main pipes the chunks to the HUD over IPC. |
| L4  | Traces: metadata (model, tokens, latency, capture type/size, errors) always. Content (text, PNG, prompts, answers) only behind a setting, off by default and on in dev/test builds. Kept 14 days. |
| L5  | **Secret redaction** on text before the model call, the trace and the history: regex for key shapes (`AIza…`, `sk-…`, `ghp_…`), JWTs, `PASSWORD=` lines, long high-entropy strings → `[redacted secret]`. The HUD shows "N secrets redacted". Images aren't covered (README). Agent-written (D18 waived). |
| L6  | Setting `panelPosition: cursor \| fixed` (fixed = right edge of the monitor), default `cursor`. Cursor = spike-4 placement with a zero-size box at the mouse. |
| L7  | **Console**: the Omnitrix app window, opened from the tray. In P1 it holds settings (API keys, models, fallbacks, panel position, traces, Recordable) and history. Later: an MCP tab (token + Claude Code snippet), a live task view, memory. Closing it keeps the app in the tray. |
| L8  | History is separate from traces and on by default (`saveHistory`), kept 14 days, deletable one at a time or all at once, redacted, with region thumbnails only. Read-only with "Copy answer". Resume waits for P5. |
| L9  | Region question: if text is already in the command box when the drag starts, use it. Otherwise an input appears by the box after mouse-up. An empty Enter gives the default explain. |
| L10 | Errors: one retry (AI SDK `maxRetries`), then the fallback model, then a short HUD message + Retry button (busy, daily limit, bad key → open Console). No fallback on a bad key or blocked content. A new hotkey press aborts the in-flight request (`AbortController`). |
| L11 | `lookFallbackModel` / `actFallbackModel` (D4 format). The defaults swap with each other: Look falls back to Flash, Act to Flash Lite. The HUD tags answers from the fallback. Act fallback is built in P2. |
| L12 | First run opens the Console with the API key field, a warning that free-tier Gemini may train on what you send, and a get-key link. Pressing the hotkey without a key → "Add API key in Console". |
| L13 | Default answers are short (2–4 sentences) and tuned to the content type (code, term, math, table/chart → key numbers, foreign text → translation). Follow-ups give depth. Agent writes the system prompt and checks it against fixture captures (D18 waived). |
| L14 | The panel stays until ✕, Esc or the next hotkey. Esc is global only until the user clicks into another app. |
| L15 | P1 is done when the features work and tests pass, **and** Showcase 1 is shipped: a recorded demo (Recordable on) + `docs/showcases/01-look.md`. |

## P0 spikes

| #   | Spike                                                                                                                                         | Answers                              | Gates    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------- |
| 1   | Raw agent loop (~100 lines, raw Gemini API, one fake tool)                                                                                    | How a ReAct loop works               | Learning |
| 2   | Overlay per monitor (transparent, click-through, on-top, content-protected, hotkey shows on right monitor)                                    | Mixed-DPI behaviour on this laptop   | P1       |
| 3   | Selection grab (Ctrl+C + clipboard restore) in Chrome, PDF, VS Code                                                                           | Reliability                          | P1       |
| 4   | Region drag + capture + Gemini vision                                                                                                         | Quality, latency, free-tier limits   | P1       |
| 5   | Playwright + dedicated Chrome profile on Google Flights, IndiGo, Air India, YouTube: snapshot size, bot blocking, element box → screen coords | Site viability, ghost cursor mapping | P2       |
| 6   | MCP server over local HTTP + token, connected from Claude Code                                                                                | Transport works end to end           | P2       |

## Key techniques (reference)

- **DPI**: Electron `screen.screenToDipRect()` / `dipToScreenRect()` (Windows). Playwright box (CSS px) × devicePixelRatio + window offset → physical → DIP.
- **Voice latency** (P3): models off the main process (`utilityProcess`), whisper.cpp prebuilt server exe (no native bindings), VAD in renderer AudioWorklet, sentence-chunked TTS, barge-in via AbortController + echo cancellation.
- **Token frugality**: accessibility text over screenshots; trim snapshots; cap steps per task.

## Environment

Ryzen 5 8640HS (6C/12T), Radeon 760M iGPU (no CUDA; Vulkan possible), 16 GB RAM. Two monitors, mixed DPI (laptop scaled, external 1920x1080 at x=-1920). Node 22.18, npm 10.9, git 2.52, gh logged in.

## Risks

- Gemini free tier: rate limits, Google may train on prompts (screen content!) → README warning.
- Flight sites: silent bot blocking (spike 5), layout changes, ToS forbid automation → README warning; fallback = compare on Google Flights + hand off.
- Local CDP port: any local process can drive the Omnitrix Chrome while open; profile holds no user logins/cards.
- Trademark on name → rename before wide release.
