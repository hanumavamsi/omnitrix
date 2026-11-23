import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSettings, REDACTED } from "@omnitrix/agent";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type AnswerInfo,
	buildRecord,
	buildTrace,
	deleteHistory,
	KEEP_MS,
	type LookSession,
	listHistory,
	prune,
	recordLook,
} from "./history.ts";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const KEY = `AIza${"x".repeat(35)}`;
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);

const textSession = (overrides: Partial<LookSession> = {}): LookSession => ({
	id: NOW,
	capture: { kind: "text", text: `key ${KEY}` },
	conversation: [{ role: "assistant", content: "It is a key." }],
	model: defaultSettings.lookModel,
	fallback: false,
	...overrides,
});

const regionSession = (): LookSession =>
	textSession({
		capture: { kind: "region", png: PNG, question: `what is ${KEY}?` },
		thumbnail: "data:image/jpeg;base64,THUMB",
	});

const done = (overrides: Partial<AnswerInfo> = {}): AnswerInfo => ({
	startedAt: NOW,
	endedAt: NOW + 1200,
	model: defaultSettings.lookModel,
	fallback: false,
	retry: false,
	answer: "It is a key.",
	usage: { inputTokens: 10, outputTokens: 4 },
	...overrides,
});

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "omnitrix-history-"));
});

const traces = () =>
	readdirSync(join(dir, "traces")).flatMap((name) =>
		readFileSync(join(dir, "traces", name), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line)),
	);

describe("buildRecord", () => {
	it("stores redacted text, the turns, the model and the fallback flag", () => {
		const record = buildRecord(
			textSession({
				conversation: [
					{ role: "assistant", content: "First." },
					{ role: "user", content: `and ${KEY}?` },
					{ role: "assistant", content: "Second." },
				],
				model: defaultSettings.lookFallbackModel,
				fallback: true,
			}),
		);
		expect(record).toEqual({
			id: NOW,
			model: defaultSettings.lookFallbackModel,
			fallback: true,
			capture: { kind: "text", text: `key ${REDACTED}` },
			turns: [
				{ role: "assistant", text: "First." },
				{ role: "user", text: `and ${REDACTED}?` },
				{ role: "assistant", text: "Second." },
			],
		});
	});

	it("keeps only the thumbnail of a region, never the PNG", () => {
		const record = buildRecord(regionSession());
		expect(record.capture).toEqual({
			kind: "region",
			thumbnail: "data:image/jpeg;base64,THUMB",
			question: `what is ${REDACTED}?`,
		});
		expect(JSON.stringify(record)).not.toContain(
			Buffer.from(PNG).toString("base64"),
		);
	});
});

describe("buildTrace", () => {
	it("always has the metadata and no content when traceContent is off", () => {
		const trace = buildTrace(regionSession(), done({ retry: true }), false);
		expect(trace).toEqual({
			time: "2026-11-23T12:00:00.000Z",
			look: NOW,
			model: defaultSettings.lookModel,
			fallback: false,
			retry: true,
			followUp: false,
			latencyMs: 1200,
			inputTokens: 10,
			outputTokens: 4,
			capture: { kind: "region", size: PNG.length },
			error: undefined,
		});
	});

	it("adds redacted content only when traceContent is on", () => {
		const trace = buildTrace(
			textSession(),
			done({ followUp: `why ${KEY}`, answer: `see ${KEY}` }),
			true,
		);
		expect(trace.capture).toEqual({ kind: "text", size: 4 + KEY.length });
		expect(trace.content).toEqual({
			capture: `key ${REDACTED}`,
			question: undefined,
			followUp: `why ${REDACTED}`,
			answer: `see ${REDACTED}`,
		});
		expect(JSON.stringify(trace)).not.toContain(KEY);
	});

	it("includes the PNG as content for a region when traceContent is on", () => {
		const trace = buildTrace(regionSession(), done(), true);
		expect(trace.content?.capture).toBe(Buffer.from(PNG).toString("base64"));
	});
});

describe("recordLook", () => {
	it("writes history and one trace line for a finished answer", () => {
		recordLook(dir, defaultSettings, regionSession(), done());
		expect(listHistory(dir)).toEqual([buildRecord(regionSession())]);
		expect(traces()).toHaveLength(1);
	});

	it("writes no history when saveHistory is off, but still the trace", () => {
		const settings = { ...defaultSettings, saveHistory: false };
		recordLook(dir, settings, textSession(), done());
		expect(listHistory(dir)).toEqual([]);
		expect(traces()).toHaveLength(1);
	});
});

describe("listHistory and deleteHistory", () => {
	beforeEach(() => {
		for (const id of [NOW - 2000, NOW, NOW - 1000])
			recordLook(dir, defaultSettings, textSession({ id }), done());
	});

	it("lists newest first", () => {
		expect(listHistory(dir).map((r) => r.id)).toEqual([
			NOW,
			NOW - 1000,
			NOW - 2000,
		]);
	});

	it("deletes one entry", () => {
		deleteHistory(dir, NOW - 1000);
		expect(listHistory(dir).map((r) => r.id)).toEqual([NOW, NOW - 2000]);
	});

	it("deletes all entries without an id", () => {
		deleteHistory(dir);
		expect(listHistory(dir)).toEqual([]);
	});

	it("rejects an id that is not a number (it comes from a renderer)", () => {
		expect(() => deleteHistory(dir, "../settings")).toThrow("Bad history id");
	});
});

describe("prune", () => {
	it("removes history and traces older than 14 days and keeps the rest", () => {
		mkdirSync(join(dir, "history"), { recursive: true });
		mkdirSync(join(dir, "traces"), { recursive: true });
		const old = NOW - KEEP_MS - 1;
		const recent = NOW - KEEP_MS + 60_000;
		for (const id of [old, recent])
			writeFileSync(join(dir, "history", `${id}.json`), JSON.stringify({ id }));
		// 2026-11-08 ended 14.5 days before NOW; 2026-11-09 ends 13.5 days before.
		for (const day of ["2026-11-08", "2026-11-09", "2026-11-23"])
			writeFileSync(join(dir, "traces", `${day}.jsonl`), "{}\n");

		prune(dir, NOW);

		expect(readdirSync(join(dir, "history"))).toEqual([`${recent}.json`]);
		expect(readdirSync(join(dir, "traces")).sort()).toEqual([
			"2026-11-09.jsonl",
			"2026-11-23.jsonl",
		]);
	});

	it("does nothing when the folders do not exist yet", () => {
		expect(() => prune(dir, NOW)).not.toThrow();
	});
});
