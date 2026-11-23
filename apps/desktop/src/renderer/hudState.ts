// The HUD's state and how messages from main and the user's input change it. Pure: no DOM.
import type { Area, HudMessage } from "../preload/index.ts";

const MIN_DRAG = 8; // a smaller box is a click, not a drag

/** One answer. Markdown streams in; a notice or an error shows plain text in its place. */
export type Answer = {
	kind: "answer";
	status: "waiting" | "done" | "error"; // waiting lasts until done, chunks included
	markdown: string;
	plain: { text: string; openConsole: boolean } | null;
};

export type Turn = { kind: "question"; text: string } | Answer;

export type HudState =
	| { kind: "hidden" }
	| {
			kind: "picking"; // the dim screen: drag a box, then maybe ask about it
			dragStart: { x: number; y: number } | null; // set while the mouse is down
			box: Area | null;
			asking: boolean; // the question input under the box is showing
	  }
	| {
			kind: "answering"; // the panel, from the first wait to done, a notice or an error
			transcript: readonly Turn[]; // earlier turns, oldest first
			current: Answer;
			fallback: boolean;
			redacted: number | null;
			retry: boolean;
			followUp: boolean;
	  };

/** What the user does in the HUD. dragMove points are already clamped to the monitor. */
export type HudEvent =
	| HudMessage
	| { type: "dragStart"; x: number; y: number }
	| { type: "dragMove"; x: number; y: number }
	| { type: "dragEnd" }
	| { type: "ask" }
	| { type: "submit" }
	| { type: "followUp"; text: string }
	| { type: "retry" };

export const initialState: HudState = { kind: "hidden" };

const waiting = (): Answer => ({
	kind: "answer",
	status: "waiting",
	markdown: "",
	plain: null,
});

// A new attempt clears these; main sends redacted and fallback again for it, and error re-offers retry.
const freshAttempt = { retry: false, fallback: false, redacted: null };

export function nextState(state: HudState, event: HudEvent): HudState {
	if (event.type === "region")
		return { kind: "picking", dragStart: null, box: null, asking: false };
	if (event.type === "answer")
		return {
			kind: "answering",
			transcript: [],
			...freshAttempt,
			current: waiting(),
			followUp: true,
		};
	if (state.kind === "picking") return nextPicking(state, event);
	if (state.kind === "answering") return nextAnswering(state, event);
	return state;
}

type Picking = Extract<HudState, { kind: "picking" }>;
type Answering = Extract<HudState, { kind: "answering" }>;

function nextPicking(state: Picking, event: HudEvent): HudState {
	const start = state.dragStart;
	switch (event.type) {
		case "dragStart":
			return {
				...state,
				dragStart: { x: event.x, y: event.y },
				box: null,
				asking: false,
			};
		case "dragMove":
			if (!start) return state;
			return {
				...state,
				box: {
					x: Math.min(start.x, event.x),
					y: Math.min(start.y, event.y),
					width: Math.abs(event.x - start.x),
					height: Math.abs(event.y - start.y),
				},
			};
		case "dragEnd": {
			if (!start) return state;
			const { box } = state;
			const tooSmall = !box || box.width < MIN_DRAG || box.height < MIN_DRAG;
			return { ...state, dragStart: null, box: tooSmall ? null : box };
		}
		case "ask":
			return { ...state, asking: true };
		case "submit":
			return state.box ? { kind: "hidden" } : state;
		default:
			return state;
	}
}

function nextAnswering(state: Answering, event: HudEvent): HudState {
	const { current } = state;
	switch (event.type) {
		case "chunk":
			return {
				...state,
				current: {
					...current,
					markdown: current.markdown + event.text,
					plain: null,
				},
			};
		case "notice":
			return {
				...state,
				current: { ...current, status: "done", plain: plain(event) },
				followUp: false, // a notice has no session to follow up on
			};
		case "error":
			return {
				...state,
				current: { ...current, status: "error", plain: plain(event) },
				retry: event.retry,
			};
		case "redacted":
			return { ...state, redacted: event.count };
		case "fallback":
			return { ...state, fallback: true };
		case "done":
			return { ...state, current: { ...current, status: "done" } };
		case "followUp":
			return {
				...state,
				...freshAttempt,
				current: waiting(),
				transcript: [
					...state.transcript,
					current,
					{ kind: "question", text: event.text },
				],
			};
		case "retry": // the retried answer replaces the failed one
			return { ...state, ...freshAttempt, current: waiting() };
		default:
			return state;
	}
}

const plain = (message: { text: string; openConsole?: boolean }) => ({
	text: message.text,
	openConsole: Boolean(message.openConsole),
});
