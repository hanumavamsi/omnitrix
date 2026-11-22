# Omnitrix — Plan

Codename `omnitrix` (Ben 10 trademark → pick public name before wide release, see D15).
Status: grilled and agreed 2026-11-22. Later phases get their own short grill when we reach them.

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
   ├─ hosts ─► packages/agent  (Vercel AI SDK loop, any model, default Gemini Flash)
   │                │ MCP client
   │                ▼
   └─ hosts ─► packages/mcp-server  (Streamable HTTP on 127.0.0.1, bearer token, Origin check, one-task lock)
                    ├─ look tools: look_selection, look_region
                    ├─ browser tools: Playwright library, dedicated Chrome profile, ariaSnapshot
                    ├─ safety tiers (enforced here, for every client)
                    └─ {{profile.*}} placeholder substitution
External MCP clients (Claude Code, Cursor, Gemini CLI) can use the same server.
```

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Build order: **Look first**, then **Act** (YouTube, then flight). Browser before Windows desktop automation.                                                                                                                                                                                                                                  |
| D2  | Flight hero: Google Flights → book on IndiGo / Air India → fill details → **hard stop at payment**, HUD summary. Stretch: Cleartrip/ixigo as second price source (parallel subagents). Sites final after spike 5.                                                                                                                             |
| D3  | Hand-written raw agent loop once (spike 1, learning), then **Vercel AI SDK** (`ai` + direct provider packages, no AI Gateway).                                                                                                                                                                                                                |
| D4  | LLM-agnostic. Default **Gemini Flash**; model = one config value (e.g. `OMNITRIX_MODEL=google:gemini-flash-latest`). No Claude subscription login inside the app (Anthropic terms) — Pro users can use the MCP server from Claude Code instead.                                                                                               |
| D5  | Core = **MCP server hosted in Electron**, Streamable HTTP on `127.0.0.1`, random bearer token (generated first run), Origin header check, one task at a time.                                                                                                                                                                                 |
| D6  | Browser: **Playwright library** inside our MCP server with our own tools (click/type pass through ghost cursor + safety gate first). Dedicated Chrome profile `--user-data-dir`.                                                                                                                                                              |
| D7  | Safety tiers enforced in server code. **Auto**: open URL, snapshot, scroll, search boxes, filters. **Confirm** (Enter/Esc on HUD): personal details, select fare, continue/book/proceed. **Never**: card/UPI/CVV/OTP/password fields, CAPTCHA, Pay. Unclear → Confirm. Kill switch `Ctrl+Alt+Esc`. Page text is untrusted (prompt injection). |
| D8  | Personal data in `%APPDATA%\omnitrix\profile.json` (never in repo); model uses `{{profile.x}}` placeholders, server substitutes at type time. Later → memory DB.                                                                                                                                                                              |
| D9  | English only.                                                                                                                                                                                                                                                                                                                                 |
| D10 | MIT license.                                                                                                                                                                                                                                                                                                                                  |
| D11 | Monorepo, **npm workspaces**: `apps/desktop`, `packages/mcp-server` (no Electron dependency), `packages/agent`. electron-vite, strict TS, plain CSS HUD, Vitest, Biome. No `shared/` until needed.                                                                                                                                            |
| D12 | Observability: JSONL traces per task in `%APPDATA%\omnitrix\traces\` now; OpenTelemetry → Langfuse (or Phoenix) later.                                                                                                                                                                                                                        |
| D13 | HUD: one overlay per monitor (created on its own display, never moved), show only the one containing the Omnitrix Chrome window. Click-through, always-on-top, `setContentProtection(true)`.                                                                                                                                                  |
| D14 | `Ctrl+Shift+Space`: selection present → grab via simulated Ctrl+C + clipboard restore → explain panel with follow-ups. No selection → dim screen + command box: type = command/question, drag = region capture (+ optional question). Answers render markdown + KaTeX. Esc cancels. Capture only on explicit user trigger.                    |
| D15 | Each hotkey press = fresh conversation (follow-ups inside open panel keep context). Upgrade later: continue if within ~5 min (time-bound memory).                                                                                                                                                                                             |
| D16 | Public GitHub repo now under codename; rename before wide release (GitHub redirects).                                                                                                                                                                                                                                                         |
| D17 | Secrets: `.gitignore` first, gitleaks pre-commit hook, GitHub secret scanning + push protection, API key stored with Electron `safeStorage` (DPAPI) via settings box, env var override for dev. Only `*.example` files in repo.                                                                                                               |
| D18 | Code split: user writes learning parts (raw loop, safety tiers, placeholders, memory, evals) from skeleton + test + hints; Claude writes plumbing and explains. TS taught via Java analogies.                                                                                                                                                 |
| D19 | Inspiration: [Roamies](https://github.com/KenKaiii/Roamies) — **AGPL-3.0, read for ideas only, copy no code.**                                                                                                                                                                                                                                |
| D20 | Shell: **Electron now; Tauri (+ Node sidecar) later only if RAM hurts.** Kept cheap because `mcp-server` and `agent` have no Electron dependency — a switch rewrites only `apps/desktop`.                                                                                                                                                     |

## Phases

| Phase                 | Deliverable                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 Spikes**         | 6 throwaway scripts in `spikes/`, findings in `docs/spikes.md` (below).                                                                |
| **P1 Look**           | Hotkey → explain selection / dragged region in HUD panel, follow-ups. MCP look tools. JSONL traces.                                    |
| **P2 Act**            | Browser tools + ghost cursor + safety tiers. "Open my YouTube, play last watched video", then flight hero to payment stop.             |
| P3 Voice              | Push-to-talk → VAD → STT → agent → streaming TTS, barge-in. Spike: Whisper vs **NVIDIA Parakeet TDT 0.6B ONNX**.                       |
| P4 Draw mode          | HUD captures pen input, "what animal is this?".                                                                                        |
| P5 Memory             | Episodic log, semantic facts (sqlite-vec + FTS5 hybrid), procedural skills, time-bound continuation (D15 upgrade). Profile moves here. |
| P6 Evals              | Offline replay of recorded tasks, online success/correction logging.                                                                   |
| P7 Desktop automation | Windows UI Automation backend; **Windows built-in OCR** for cheap text grounding; WhatsApp share.                                      |
| P8 Extras             | Wake word, full-screen diagrams, RAM/CPU + token watchdog, OpenTelemetry/Langfuse.                                                     |

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
- Flight sites: CAPTCHAs, bot detection, layout changes → spike 5 decides sites.
- Trademark on name → rename before wide release.
