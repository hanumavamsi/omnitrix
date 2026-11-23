import DOMPurify from "dompurify";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import type { Area, HudMessage, OmniApi } from "../preload/index.ts";
import {
	type HudEvent,
	type HudState,
	initialState,
	nextState,
	type Turn,
} from "./hudState.ts";
import { placePanel, placeQuestion } from "./placement.ts";

declare global {
	interface Window {
		omni: OmniApi;
	}
}

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

let state: HudState = initialState;

function dispatch(event: HudEvent) {
	state = nextState(state, event);
	render(state);
}

// --- Render: the only place that shows or hides anything ---

function render(state: HudState) {
	dim.hidden = state.kind !== "picking";
	panel.hidden = state.kind !== "answering";
	if (state.kind === "picking") {
		box.hidden = !state.box;
		if (state.box) setBox(state.box);
		boxQuestion.hidden = !state.asking;
		if (state.asking && state.box) {
			const { left, top } = placeQuestion(state.box, {
				width: innerWidth,
				height: innerHeight,
			});
			Object.assign(boxQuestion.style, { left: `${left}px`, top: `${top}px` });
		}
	}
	if (state.kind === "answering") {
		renderTurns([...state.transcript, state.current]);
		followUp.hidden = !state.followUp;
		retryButton.hidden = !state.retry;
		fallbackTag.hidden = !state.fallback;
		redacted.hidden = state.redacted === null;
		if (state.redacted !== null)
			redacted.textContent = `${state.redacted} secret${state.redacted === 1 ? "" : "s"} redacted`;
	}
}

function setBox(rect: Area) {
	Object.assign(box.style, {
		left: `${rect.x}px`,
		top: `${rect.y}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
	});
}

let shownTurns: readonly Turn[] = [];

/** Updates only the turns that changed (state is immutable), so a chunk re-renders one answer. */
function renderTurns(turns: readonly Turn[]) {
	turns.forEach((turn, i) => {
		const before = shownTurns[i];
		if (before === turn) return;
		const element =
			(transcript.children[i] as HTMLElement | undefined) ??
			transcript.appendChild(document.createElement("div"));
		renderTurn(element, turn, before);
	});
	while (transcript.children.length > turns.length)
		transcript.lastElementChild?.remove();
	shownTurns = turns;
}

const answerClass = {
	waiting: "answer waiting",
	done: "answer",
	error: "answer error",
};

function renderTurn(element: HTMLElement, turn: Turn, before?: Turn) {
	if (turn.kind === "question") {
		element.className = "question";
		element.textContent = turn.text;
		return;
	}
	element.className = answerClass[turn.status];
	const sameContent =
		before?.kind === "answer" &&
		before.markdown === turn.markdown &&
		before.plain === turn.plain;
	if (sameContent) return; // only the status changed, e.g. done
	if (!turn.plain) {
		element.innerHTML = renderMarkdown(turn.markdown);
		return;
	}
	element.textContent = turn.plain.text;
	if (!turn.plain.openConsole) return;
	const button = document.createElement("button");
	button.type = "button";
	button.className = "action";
	button.textContent = "Open Console";
	button.addEventListener("click", () => window.omni.openConsole());
	element.append(button);
}

// --- Answer panel ---

function applyPlacement(message: Extract<HudMessage, { type: "answer" }>) {
	const placed = placePanel({
		box: message.box,
		area: message.area,
		panel: { width: panel.offsetWidth }, // measured, so the panel must already be shown
		position: message.position,
	});
	Object.assign(panel.style, {
		left: `${placed.left}px`,
		top: "top" in placed ? `${placed.top}px` : "auto",
		bottom: "bottom" in placed ? `${innerHeight - placed.bottom}px` : "auto",
		maxHeight: `${placed.maxHeight}px`,
	});
}

followUp.addEventListener("keydown", (event) => {
	const text = followUp.value.trim();
	if (event.key !== "Enter" || !text) return;
	followUp.value = "";
	dispatch({ type: "followUp", text });
	transcript.scrollTop = transcript.scrollHeight;
	window.omni.followUp(text);
});

// --- Region selection (dim screen) ---

dim.addEventListener("mousedown", (event) => {
	if (event.target instanceof HTMLInputElement) return; // clicking an input is typing, not dragging
	dispatch({ type: "dragStart", x: event.clientX, y: event.clientY });
});

addEventListener("mousemove", (event) => {
	if (state.kind !== "picking" || !state.dragStart) return;
	// Clamp to this monitor: dragging past its edge must not leave the HUD.
	const x = Math.min(Math.max(event.clientX, 0), innerWidth);
	const y = Math.min(Math.max(event.clientY, 0), innerHeight);
	dispatch({ type: "dragMove", x, y });
});

addEventListener("mouseup", () => {
	if (state.kind !== "picking" || !state.dragStart) return;
	dispatch({ type: "dragEnd" });
	if (!state.box) return;
	if (command.value.trim()) return submitRegion(command.value); // question typed before the drag
	boxQuestion.value = "";
	dispatch({ type: "ask" });
	boxQuestion.focus();
});

boxQuestion.addEventListener("keydown", (event) => {
	if (event.key === "Enter") submitRegion(boxQuestion.value); // empty = default explain
});

const nextFrame = () =>
	new Promise((resolve) => requestAnimationFrame(resolve));

async function submitRegion(question: string) {
	if (state.kind !== "picking" || !state.box) return;
	const captured = state.box;
	dispatch({ type: "submit" });
	// With Recordable on there is no content protection, so the dim layer must be off screen before main grabs it.
	await nextFrame();
	await nextFrame();
	window.omni.region(captured, question);
}

// --- Messages from main ---

window.omni.onMessage((message: HudMessage) => {
	dispatch(message);
	if (message.type === "region") {
		command.value = "";
		command.focus();
	}
	if (message.type === "answer") {
		followUp.value = "";
		applyPlacement(message);
		followUp.focus();
	}
});

closeButton.addEventListener("click", () => window.omni.close());
retryButton.addEventListener("click", () => {
	dispatch({ type: "retry" });
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
