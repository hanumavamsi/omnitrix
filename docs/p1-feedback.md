# P1 feedback (owner testing, 2026-11-24)

The owner tested P1 Look by hand and sent 9 suggestions. They are sorted below into buckets. The next session starts here: grill the open questions (one at a time), then spec and ticket each bucket. P2 Act waits until these are sorted.

## A. Bugs (fix first)

| # | Suggestion | Notes |
| --- | --- | --- |
| 2 | "When the HUD is on, I can't take screenshots at all." Major flaw. | **Resolved (P1.1): Recordable on by default**, so the HUD shows in screenshots (D13). The black snip could not be reproduced: parked, reopen if it returns. Suspect: content protection (`WDA_EXCLUDEFROMCAPTURE`, `main/hud.ts:56`) when Recordable is off. |
| 8 | After dragging a box, sometimes the question input isn't visible. | Likely cause: `placeQuestion` (`renderer/placement.ts:72`) clamps to the whole monitor, not the work area, so a low box puts the input behind the taskbar. Also, a box that is nearly full height puts the input on top of the box. **Open question:** a repro (where the box was). |

## B. Polish (small)

| # | Suggestion | Notes |
| --- | --- | --- |
| 7 | The panel's scrollbar is ugly. | Style a thin scrollbar that matches the alien-tech look (CSS `::-webkit-scrollbar`). |

## C. Look enhancements (extend P1)

| # | Suggestion | Notes / conflicts |
| --- | --- | --- |
| 1 | The user can move and resize the HUD panel, and that becomes their default. | Changes L-decisions on placement (cursor / fixed). Likely a third `panelPosition` ("remembered"), or drag/resize that saves into settings. The panel area must stop being click-through while dragging. |
| 3 | A highlighter/pencil in follow-ups: mark what you have a doubt about on screen, press Enter to ask. | Close to the region drag, but freehand marks instead of a box, sent with the follow-up. Overlaps P4 Draw mode (pen input on the HUD); decide whether it pulls P4 forward. |
| 9a | Look at the **whole screen** ("explain what this does"). | Small: a full-screen capture variant of Look (a hotkey or a command in the dim screen). The voice trigger ("hey Omnitrix") is P3 and P8 (wake word), out of scope here. |

## D. "Explain visually": a new feature area (design first)

These belong together: the agent *shows* rather than only *tells*. It needs its own grill and design pass. The owner wants a Claude design for it.

| # | Suggestion | Notes / conflicts |
| --- | --- | --- |
| 4 | An agent-only **canvas**: a blank surface where the agent draws diagrams to explain. | New. Not the same as P4 Draw mode (that one is user pen input). Decide what the agent draws with: SVG, Mermaid, or tool calls that draw shapes. |
| 6 | The agent **highlights places on the page/screen** as it explains them. | Needs grounding: screen coordinates for what it talks about (Gemini bounding boxes on the capture, or P7 OCR / UI Automation). Draws on the HUD overlay. |
| 9b | Look at the whole site/screen, then explain **on the page itself** with the canvas and highlights. | A combination of 9a, 4 and 6. |
| 5 | Pixel-art anime agents appear on screen and explain in simple words. The owner will attach a reference screenshot. | **Conflicts with the HUD design direction**: the minimal alien-tech canvas was chosen, and the characters canvas was kept but not used. Reopen that choice in the design pass. |

## Suggested order

1. Bucket A + B (bugs and polish): a quick P1.1.
2. Bucket C: Look enhancements; spec and tickets like P1.
3. Bucket D: grill and design (Claude design), then decide where it sits relative to P2 Act.
