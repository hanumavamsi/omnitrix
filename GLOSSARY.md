# Omnitrix

Windows desktop assistant that understands what is on screen and acts in the browser through a HUD.

## Language

**Look**:
The half of Omnitrix that understands on-screen content the user points at (a selection or a dragged region) and explains it.
_Avoid_: Vision mode, explain mode

**Act**:
The half of Omnitrix that performs steps in an app on the user's behalf, visibly and behind safety gates.
_Avoid_: Automation, agent mode

**Hand-over**:
The agent stops a task and gives control back to the user, with the page left as it is and the reason shown in the HUD.
_Avoid_: Fallback, abort, bail out

**HUD**:
The see-through overlay where Omnitrix shows answers and actions on top of whatever the user is doing.
_Avoid_: Overlay window, popup

**Console**:
The Omnitrix app window, opened from the tray, where the user changes settings and looks back at past conversations.
_Avoid_: Dashboard, settings window, main window

**Showcase**:
One end-to-end task chosen to prove one capability of Omnitrix, with a recorded demo and a write-up. There are a few, never one.
_Avoid_: Hero, demo flow
