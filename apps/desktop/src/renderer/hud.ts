import type { OmniApi } from "../preload/index.ts";

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

// Below or above the cursor, whichever has more room, capped to that room so it never runs off-screen.
function placeNear(x: number, y: number) {
	const roomBelow = innerHeight - y - GAP - MARGIN;
	const roomAbove = y - GAP - MARGIN;
	const left = Math.min(
		Math.max(x, MARGIN),
		innerWidth - panel.offsetWidth - MARGIN,
	);
	panel.style.left = `${Math.max(MARGIN, left)}px`;
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
			panel.hidden = false;
			placeNear(message.x, message.y);
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
