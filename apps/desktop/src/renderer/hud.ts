import DOMPurify from "dompurify";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import type { Area, HudMessage, OmniApi } from "../preload/index.ts";

declare global {
	interface Window {
		omni: OmniApi;
	}
}

const MARGIN = 8; // keep clear of the screen edge
const GAP = 14; // keep clear of the cursor or the box
const MIN_ROOM = 160; // with less room than this beside the box, the panel goes inside it
const MIN_DRAG = 8; // a smaller box is a click, not a drag

const dim = document.getElementById("dim") as HTMLElement;
const command = document.getElementById("command") as HTMLInputElement;
const box = document.getElementById("box") as HTMLElement;
const boxQuestion = document.getElementById("box-question") as HTMLInputElement;
const panel = document.getElementById("panel") as HTMLElement;
const transcript = document.getElementById("transcript") as HTMLElement;
const followUp = document.getElementById("follow-up") as HTMLInputElement;
const closeButton = document.getElementById("close") as HTMLButtonElement;
const retryButton = document.getElementById("retry") as HTMLButtonElement;
const fallbackTag = document.getElementById("fallback-tag") as HTMLElement;
const redacted = document.getElementById("redacted") as HTMLElement;

marked.use(markedKatex({ throwOnError: false }));

// Model output is untrusted, so the HTML is always sanitized before it reaches the page.
function renderMarkdown(text: string) {
	return DOMPurify.sanitize(marked.parse(text, { async: false }));
}

// --- Answer panel ---

let answer = document.createElement("div"); // the answer streaming in now
let answerText = "";

/** Empties the current answer for a new attempt; main sends the redacted count and fallback tag again. */
function resetAnswer() {
	answer.className = "answer waiting";
	answer.textContent = "";
	answerText = "";
	retryButton.hidden = true;
	fallbackTag.hidden = true;
	redacted.hidden = true;
}

function startAnswer() {
	answer = document.createElement("div");
	transcript.append(answer);
	resetAnswer();
}

/** Plain text in the current answer, plus an "Open Console" button when main asks for one. */
function showText(className: string, text: string, openConsole?: boolean) {
	answer.className = className;
	answer.textContent = text;
	if (!openConsole) return;
	const button = document.createElement("button");
	button.type = "button";
	button.className = "action";
	button.textContent = "Open Console";
	button.addEventListener("click", () => window.omni.openConsole());
	answer.append(button);
}

function setPanel(
	left: number,
	top: number | null,
	bottom: number | null,
	maxHeight: number,
) {
	Object.assign(panel.style, {
		left: `${left}px`,
		top: top === null ? "auto" : `${top}px`,
		bottom: bottom === null ? "auto" : `${bottom}px`,
		maxHeight: `${maxHeight}px`,
	});
}

// Beside the box (a zero-size box for the cursor) on the side with more room, capped to that room
// so it never leaves the work area; inside the box when the box nearly fills the screen.
function place(target: Area, area: Area, position: "cursor" | "fixed") {
	const right = area.x + area.width - panel.offsetWidth - MARGIN;
	const bottom = area.y + area.height;
	if (position === "fixed")
		return setPanel(right, area.y + MARGIN, null, area.height - 2 * MARGIN);

	const clampLeft = (x: number) =>
		Math.max(area.x + MARGIN, Math.min(x, right));
	// The cursor or box can reach onto the taskbar, outside the work area.
	const clampY = (y: number) => Math.min(Math.max(y, area.y), bottom);
	const boxTop = clampY(target.y);
	const boxBottom = clampY(target.y + target.height);
	const roomBelow = bottom - boxBottom - GAP - MARGIN;
	const roomAbove = boxTop - area.y - GAP - MARGIN;
	if (Math.max(roomBelow, roomAbove) < MIN_ROOM) {
		const top = boxTop + MARGIN;
		return setPanel(
			clampLeft(target.x + MARGIN),
			top,
			null,
			boxBottom - top - MARGIN,
		);
	}
	if (roomBelow >= roomAbove)
		setPanel(clampLeft(target.x), boxBottom + GAP, null, roomBelow);
	else
		setPanel(clampLeft(target.x), null, innerHeight - boxTop + GAP, roomAbove);
}

followUp.addEventListener("keydown", (event) => {
	const text = followUp.value.trim();
	if (event.key !== "Enter" || !text) return;
	followUp.value = "";
	const question = document.createElement("div");
	question.className = "question";
	question.textContent = text;
	transcript.append(question);
	startAnswer();
	transcript.scrollTop = transcript.scrollHeight;
	window.omni.followUp(text);
});

// --- Region selection (dim screen) ---

let start: { x: number; y: number } | null = null;
let rect: Area | null = null;

dim.addEventListener("mousedown", (event) => {
	if (event.target instanceof HTMLInputElement) return; // clicking an input is typing, not dragging
	start = { x: event.clientX, y: event.clientY };
	rect = null;
	boxQuestion.hidden = true;
	box.hidden = true;
});

addEventListener("mousemove", (event) => {
	if (!start) return;
	// Clamp to this monitor: dragging past its edge must not leave the HUD.
	const x = Math.min(Math.max(event.clientX, 0), innerWidth);
	const y = Math.min(Math.max(event.clientY, 0), innerHeight);
	rect = {
		x: Math.min(start.x, x),
		y: Math.min(start.y, y),
		width: Math.abs(x - start.x),
		height: Math.abs(y - start.y),
	};
	Object.assign(box.style, {
		left: `${rect.x}px`,
		top: `${rect.y}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
	});
	box.hidden = false;
});

addEventListener("mouseup", () => {
	if (!start) return;
	start = null;
	if (!rect || rect.width < MIN_DRAG || rect.height < MIN_DRAG) {
		rect = null;
		box.hidden = true;
		return;
	}
	if (command.value.trim()) return submitRegion(command.value); // question typed before the drag
	Object.assign(boxQuestion.style, {
		left: `${Math.max(0, Math.min(rect.x, innerWidth - 330))}px`,
		top: `${Math.min(rect.y + rect.height + 6, innerHeight - 40)}px`,
	});
	boxQuestion.value = "";
	boxQuestion.hidden = false;
	boxQuestion.focus();
});

boxQuestion.addEventListener("keydown", (event) => {
	if (event.key === "Enter") submitRegion(boxQuestion.value); // empty = default explain
});

const nextFrame = () =>
	new Promise((resolve) => requestAnimationFrame(resolve));

async function submitRegion(question: string) {
	if (!rect) return;
	const captured = rect;
	rect = null;
	dim.hidden = true;
	// With Recordable on there is no content protection, so the dim layer must be off screen before main grabs it.
	await nextFrame();
	await nextFrame();
	window.omni.region(captured, question);
}

// --- Messages from main ---

window.omni.onMessage((message: HudMessage) => {
	switch (message.type) {
		case "region":
			panel.hidden = true;
			box.hidden = true;
			boxQuestion.hidden = true;
			start = rect = null;
			command.value = "";
			dim.hidden = false;
			command.focus();
			break;
		case "answer":
			dim.hidden = true;
			transcript.replaceChildren();
			followUp.value = "";
			startAnswer();
			panel.hidden = false;
			place(message.box, message.area, message.position);
			followUp.focus();
			break;
		case "chunk":
			answerText += message.text;
			answer.innerHTML = renderMarkdown(answerText);
			break;
		case "notice":
			showText("answer", message.text, message.openConsole);
			break;
		case "error":
			showText("answer error", message.text, message.openConsole);
			retryButton.hidden = !message.retry;
			break;
		case "redacted":
			redacted.textContent = `${message.count} secret${message.count === 1 ? "" : "s"} redacted`;
			redacted.hidden = false;
			break;
		case "fallback":
			fallbackTag.hidden = false;
			break;
		case "done":
			answer.className = "answer";
			break;
	}
});

closeButton.addEventListener("click", () => window.omni.close());
retryButton.addEventListener("click", () => {
	resetAnswer(); // the retried answer replaces the failed one
	window.omni.retry();
});
addEventListener(
	"keydown",
	(event) => event.key === "Escape" && window.omni.close(),
);
// The window is click-through; only the panel itself takes the mouse. The dim screen takes it all.
panel.addEventListener(
	"mouseenter",
	() => dim.hidden && window.omni.pointerOverPanel(true),
);
panel.addEventListener(
	"mouseleave",
	() => dim.hidden && window.omni.pointerOverPanel(false),
);
