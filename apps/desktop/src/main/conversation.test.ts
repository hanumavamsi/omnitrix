import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultSettings,
	LookError,
	type LookRequest,
	type look,
} from "@omnitrix/agent";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type ConversationEvent,
	createConversation,
	NO_CONVERSATION,
	NO_KEY,
} from "./conversation.ts";
import { listHistory, recordLook } from "./history.ts";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const TEXT = { kind: "text", text: "const x = 1;" } as const;

// What a mock look does with one request: the chunks to stream, or how to fail.
type Script = {
	chunks?: string[];
	error?: LookError;
	fallback?: boolean;
	/** Streams nothing until the request is aborted, then throws as look does. */
	hang?: boolean;
};

let dir: string;
let events: ConversationEvent[];
let requests: LookRequest[];
let scripts: Script[];
let apiKey: string | undefined;

const mockLook = ((request: LookRequest) => {
	requests.push({ ...request, conversation: [...request.conversation] }); // as it was at the call
	const script = scripts.shift() ?? { chunks: ["ok"] };
	async function* stream() {
		if (script.fallback) request.onFallback?.();
		if (script.hang)
			await new Promise((resolve) =>
				request.signal.addEventListener("abort", resolve),
			);
		if (request.signal.aborted) throw new LookError("aborted");
		if (script.error) throw script.error;
		yield* script.chunks ?? [];
	}
	return { textStream: stream(), redactedCount: 0 };
}) as typeof look;

const make = () =>
	createConversation({
		look: mockLook,
		getApiKey: () => apiKey,
		getSettings: () => defaultSettings,
		record: (session, info) => recordLook(dir, defaultSettings, session, info),
		now: () => NOW,
		emit: (event) => events.push(event),
	});

const traces = () =>
	readdirSync(join(dir, "traces")).flatMap((name) =>
		readFileSync(join(dir, "traces", name), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line)),
	);

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "omnitrix-conversation-"));
	events = [];
	requests = [];
	scripts = [];
	apiKey = "test-key";
});

describe("conversation", () => {
	it("streams chunks in order, then done, and saves the Look", async () => {
		scripts.push({ chunks: ["It is ", "a const."] });
		await make().start(TEXT);
		expect(events).toEqual([
			{ type: "chunk", text: "It is " },
			{ type: "chunk", text: "a const." },
			{ type: "done" },
		]);
		expect(listHistory(dir)[0]?.turns).toEqual([
			{ role: "assistant", text: "It is a const." },
		]);
	});

	it("keeps the turns for a follow-up and rewrites one history entry per Look", async () => {
		scripts.push({ chunks: ["First."] }, { chunks: ["Second."] });
		const conversation = make();
		await conversation.start(TEXT);
		await conversation.ask("why?");

		expect(requests[1]?.conversation).toEqual([
			{ role: "assistant", content: "First." },
		]);
		expect(requests[1]?.followUp).toBe("why?");
		expect(listHistory(dir).map((r) => r.turns)).toEqual([
			[
				{ role: "assistant", text: "First." },
				{ role: "user", text: "why?" },
				{ role: "assistant", text: "Second." },
			],
		]);
		expect(traces()).toHaveLength(2);
	});

	it("retries the last question with the same capture", async () => {
		scripts.push(
			{ chunks: ["First."] },
			{ error: new LookError("busy") },
			{ chunks: ["Second."] },
		);
		const conversation = make();
		await conversation.start(TEXT);
		await conversation.ask("why?");
		expect(events.at(-1)).toEqual({
			type: "error",
			text: "Gemini busy, retry",
			retry: true,
			openConsole: false,
		});
		await conversation.retry();

		expect(requests[2]?.capture).toEqual(TEXT);
		expect(requests[2]?.followUp).toBe("why?");
		expect(traces().map((t) => [t.retry, t.error])).toEqual([
			[false, undefined],
			[false, "busy"],
			[true, undefined],
		]);
		expect(listHistory(dir)[0]?.turns).toHaveLength(3); // the failed try left no turn
	});

	it("aborts on close: an aborted trace, no history and nothing sent to the HUD", async () => {
		scripts.push({ hang: true });
		const conversation = make();
		const answering = conversation.start(TEXT);
		conversation.close();
		await answering;

		expect(events).toEqual([]);
		expect(traces().map((t) => t.error)).toEqual(["aborted"]);
		expect(listHistory(dir)).toEqual([]);
	});

	it("aborts the old answer when a new one starts", async () => {
		scripts.push({ hang: true }, { chunks: ["New."] });
		const conversation = make();
		const old = conversation.start(TEXT);
		await conversation.start({ kind: "text", text: "other" });
		await old;

		expect(events).toEqual([{ type: "chunk", text: "New." }, { type: "done" }]);
		expect(
			traces()
				.map((t) => t.error)
				.sort(),
		).toEqual(["aborted", undefined]);
	});

	it("flags an answer from the fallback model", async () => {
		scripts.push({ chunks: ["ok"], fallback: true });
		await make().start(TEXT);

		expect(events[0]).toEqual({ type: "fallback" });
		expect(traces()[0]).toMatchObject({
			fallback: true,
			model: defaultSettings.lookFallbackModel,
		});
		expect(listHistory(dir)[0]).toMatchObject({
			fallback: true,
			model: defaultSettings.lookFallbackModel,
		});
	});

	it("tells the HUD there is nothing to follow up on without a conversation", async () => {
		const conversation = make();
		await conversation.ask("why?"); // e.g. after a failed region capture
		await conversation.retry();
		expect(events).toEqual([NO_CONVERSATION, NO_CONVERSATION]);
		expect(requests).toEqual([]);
	});

	it("asks for the key instead of calling look without one", async () => {
		apiKey = undefined;
		await make().start(TEXT);
		expect(events).toEqual([NO_KEY]);
		expect(requests).toEqual([]);
	});
});
