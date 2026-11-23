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
const closeButton = document.getElementById("close") as HTMLButtonElement;
const retryButton = document.getElementById("retry") as HTMLButtonElement;
const fallbackTag = document.getElementById("fallback-tag") as HTMLElement;

function startAnswer() {
	answer.textContent = "";
	answer.className = "waiting";
	retryButton.hidden = true;
	fallbackTag.hidden = true;
}

// Below or above the cursor, whichever has more room, capped to that room so it never leaves the work area.
function placeNear(x: number, y: number, area: Area) {
	const bottom = area.y + area.height;
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
			startAnswer();
			panel.hidden = false;
			placeNear(message.x, message.y, message.area);
			break;
		case "chunk":
			answer.append(message.text);
			break;
		case "notice":
			answer.className = "";
			answer.textContent = message.text;
			break;
		case "error":
			answer.className = "error";
			answer.textContent = message.text;
			retryButton.hidden = !message.retry;
			break;
		case "fallback":
			fallbackTag.hidden = false;
			break;
		case "done":
			answer.className = "";
			break;
	}
});

closeButton.addEventListener("click", () => window.omni.close());
retryButton.addEventListener("click", () => {
	startAnswer();
	window.omni.retry();
});
addEventListener(
	"keydown",
	(event) => event.key === "Escape" && window.omni.close(),
);
// The window is click-through; only the panel itself takes the mouse.
panel.addEventListener("mouseenter", () => window.omni.pointerOverPanel(true));
panel.addEventListener("mouseleave", () => window.omni.pointerOverPanel(false));
