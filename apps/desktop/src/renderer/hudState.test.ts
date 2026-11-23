import { describe, expect, it } from "vitest";
import type { HudMessage } from "../preload/index.ts";
import {
	type HudEvent,
	type HudState,
	initialState,
	nextState,
} from "./hudState.ts";

const run = (events: HudEvent[], from: HudState = initialState) =>
	events.reduce(nextState, from);

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const answer: HudMessage = {
	type: "answer",
	box: { x: 0, y: 0, width: 0, height: 0 },
	area,
	position: "cursor",
};

function answering(state: HudState) {
	if (state.kind !== "answering")
		throw new Error(`expected answering, got ${state.kind}`);
	return state;
}

describe("nextState", () => {
	it("region -> drag -> answer -> chunks -> done", () => {
		let state = run([
			{ type: "region", area },
			{ type: "dragStart", x: 100, y: 100 },
			{ type: "dragMove", x: 50, y: 300 },
			{ type: "dragEnd" },
		]);
		expect(state).toEqual({
			kind: "picking",
			dragStart: null,
			box: { x: 50, y: 100, width: 50, height: 200 },
			asking: false,
		});
		state = run([{ type: "ask" }, { type: "submit" }], state);
		expect(state).toEqual({ kind: "hidden" });

		state = run(
			[answer, { type: "chunk", text: "Hel" }, { type: "chunk", text: "lo" }],
			state,
		);
		expect(answering(state).current).toEqual({
			kind: "answer",
			status: "waiting",
			markdown: "Hello",
			plain: null,
		});
		state = nextState(state, { type: "done" });
		expect(answering(state).current.status).toBe("done");
		expect(answering(state).followUp).toBe(true);
	});

	it("a drag smaller than a click leaves no box", () => {
		const state = run([
			{ type: "region", area },
			{ type: "dragStart", x: 100, y: 100 },
			{ type: "dragMove", x: 104, y: 300 },
			{ type: "dragEnd" },
			{ type: "submit" },
		]);
		expect(state).toMatchObject({ kind: "picking", box: null });
	});

	it("error offers retry; retry clears the per-answer flags", () => {
		let state = run([
			answer,
			{ type: "redacted", count: 2 },
			{ type: "fallback" },
			{ type: "chunk", text: "partial" },
			{ type: "error", text: "Quota", retry: true },
		]);
		expect(answering(state)).toMatchObject({
			retry: true,
			fallback: true,
			redacted: 2,
			current: {
				status: "error",
				plain: { text: "Quota", openConsole: false },
			},
		});
		state = nextState(state, { type: "retry" });
		expect(answering(state)).toMatchObject({
			retry: false,
			fallback: false,
			redacted: null,
			transcript: [],
			current: { status: "waiting", markdown: "", plain: null },
		});
	});

	it("a notice hides the follow-up and can offer the Console", () => {
		const state = run([
			answer,
			{ type: "notice", text: "Add API key in Console", openConsole: true },
		]);
		expect(answering(state)).toMatchObject({
			followUp: false,
			current: {
				status: "done",
				plain: { text: "Add API key in Console", openConsole: true },
			},
		});
	});

	it("keeps the redacted count and the fallback tag", () => {
		const state = run([
			answer,
			{ type: "redacted", count: 1 },
			{ type: "fallback" },
		]);
		expect(answering(state)).toMatchObject({ redacted: 1, fallback: true });
	});

	it("a follow-up keeps the transcript; a new answer clears it", () => {
		let state = run([
			answer,
			{ type: "redacted", count: 1 },
			{ type: "chunk", text: "first" },
			{ type: "done" },
			{ type: "followUp", text: "why?" },
		]);
		expect(answering(state)).toMatchObject({
			redacted: null,
			transcript: [
				{ kind: "answer", markdown: "first" },
				{ kind: "question", text: "why?" },
			],
			current: { status: "waiting", markdown: "" },
		});
		state = nextState(state, answer);
		expect(answering(state).transcript).toEqual([]);
		expect(answering(state).current.markdown).toBe("");
	});

	it("ignores panel messages when no panel is open", () => {
		expect(nextState(initialState, { type: "chunk", text: "x" })).toBe(
			initialState,
		);
	});
});
