import type { Area, OmniApi } from "../preload/index.ts";

declare global {
	interface Window {
		omni: OmniApi;
	}
}

const MARGIN = 8; // keep clear of the screen edge
const GAP = 14; // keep clear of the cursor

const panel = document.getElementById("panel") as HTMLElement;
const answer = document.getElementById("answer") as HTMLElement;
const redacted = document.getElementById("redacted") as HTMLElement;
const closeButton = document.getElementById("close") as HTMLButtonElement;

// Below or above the cursor, whichever has more room, capped to that room so it never leaves the work area.
function placeNear(cursorX: number, cursorY: number, area: Area) {
	const bottom = area.y + area.height;
	// The cursor can be on the taskbar, outside the work area.
	const x = Math.min(Math.max(cursorX, area.x), area.x + area.width);
	const y = Math.min(Math.max(cursorY, area.y), bottom);
	const roomBelow = bottom - y - GAP - MARGIN;
	const roomAbove = y - area.y - GAP - MARGIN;
	const left = Math.min(
		Math.max(x, area.x + MARGIN),
		area.x + area.width - panel.offsetWidth - MARGIN,
	);
	panel.style.left = `${Math.max(area.x + MARGIN, left)}px`;
	if (roomBelow >= roomAbove) {
		Object.assign(panel.style, {
			top: `${y + GAP}px`,
			bottom: "auto",
			maxHeight: `${roomBelow}px`,
		});
	} else {
		Object.assign(panel.style, {
			top: "auto",
			bottom: `${innerHeight - y + GAP}px`,
			maxHeight: `${roomAbove}px`,
		});
	}
}

window.omni.onMessage((message) => {
	switch (message.type) {
		case "open":
			answer.textContent = "";
			answer.className = "waiting";
			redacted.hidden = true;
			panel.hidden = false;
			placeNear(message.x, message.y, message.area);
			break;
		case "chunk":
			answer.append(message.text);
			break;
		case "notice":
			answer.className = "";
			answer.textContent = message.text;
			if (message.openConsole) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "action";
				button.textContent = "Open Console";
				button.addEventListener("click", () => window.omni.openConsole());
				answer.append("\n", button);
			}
			break;
		case "redacted":
			redacted.textContent = `${message.count} secret${message.count === 1 ? "" : "s"} redacted`;
			redacted.hidden = false;
			break;
		case "error":
			answer.className = "error";
			answer.textContent = message.text;
			break;
		case "done":
			answer.className = "";
			break;
	}
});

closeButton.addEventListener("click", () => window.omni.close());
addEventListener(
	"keydown",
	(event) => event.key === "Escape" && window.omni.close(),
);
// The window is click-through; only the panel itself takes the mouse.
panel.addEventListener("mouseenter", () => window.omni.pointerOverPanel(true));
panel.addEventListener("mouseleave", () => window.omni.pointerOverPanel(false));
