// Look history (L8) and JSONL traces (L4), both under the data dir and kept 14 days.
// No electron imports: tests run all of this against a temp dir.
import {
	appendFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	type Capture,
	type LookErrorKind,
	type ModelMessage,
	redact,
	type Settings,
} from "@omnitrix/agent";

const DAY_MS = 24 * 60 * 60 * 1000;
export const KEEP_MS = 14 * DAY_MS;

/** One Look conversation: the capture and its turns, open until the panel closes. */
export type LookSession = {
	/** Date.now() at the hotkey press; also the history file name. */
	id: number;
	capture: Capture;
	/** Region only: a small JPEG data URL made in main. History never gets the full PNG. */
	thumbnail?: string;
	conversation: ModelMessage[];
	/** The model of the last answer, and whether any answer came from the fallback. */
	model: string;
	fallback: boolean;
};

/** How one answer of a session went. answer is set only when it streamed to the end. */
export type AnswerInfo = {
	startedAt: number;
	endedAt: number;
	model: string;
	fallback: boolean;
	retry: boolean; // the user pressed Retry
	followUp?: string;
	answer?: string;
	error?: LookErrorKind;
	usage?: { inputTokens?: number; outputTokens?: number };
};

export type HistoryRecord = {
	id: number;
	model: string;
	fallback: boolean;
	capture:
		| { kind: "text"; text: string }
		| { kind: "region"; thumbnail: string; question?: string };
	turns: { role: "user" | "assistant"; text: string }[];
};

const clean = (text: string) => redact(text).text;
const textOf = (message: ModelMessage) =>
	typeof message.content === "string" ? message.content : "";

export function buildRecord(session: LookSession): HistoryRecord {
	const { capture } = session;
	return {
		id: session.id,
		model: session.model,
		fallback: session.fallback,
		capture:
			capture.kind === "text"
				? { kind: "text", text: clean(capture.text) }
				: {
						kind: "region",
						thumbnail: session.thumbnail ?? "",
						...(capture.question && { question: clean(capture.question) }),
					},
		turns: session.conversation.flatMap((message) =>
			message.role === "user" || message.role === "assistant"
				? [{ role: message.role, text: clean(textOf(message)) }]
				: [],
		),
	};
}

/** One JSONL line. size is characters for text, PNG bytes for a region. */
export function buildTrace(
	session: LookSession,
	info: AnswerInfo,
	traceContent: boolean,
) {
	const { capture } = session;
	return {
		time: new Date(info.startedAt).toISOString(),
		look: session.id,
		model: info.model,
		fallback: info.fallback,
		retry: info.retry,
		followUp: Boolean(info.followUp),
		latencyMs: info.endedAt - info.startedAt,
		inputTokens: info.usage?.inputTokens,
		outputTokens: info.usage?.outputTokens,
		capture: {
			kind: capture.kind,
			size: capture.kind === "text" ? capture.text.length : capture.png.length,
		},
		error: info.error,
		...(traceContent && {
			content: {
				capture:
					capture.kind === "text"
						? clean(capture.text)
						: Buffer.from(capture.png).toString("base64"),
				question:
					capture.kind === "region" && capture.question
						? clean(capture.question)
						: undefined,
				followUp: info.followUp && clean(info.followUp),
				answer: info.answer && clean(info.answer),
			},
		}),
	};
}

const historyDir = (dir: string) => join(dir, "history");
const tracesDir = (dir: string) => join(dir, "traces");

/** Writes the trace always, and the history only for a finished answer with saveHistory on. */
export function recordLook(
	dir: string,
	settings: Settings,
	session: LookSession,
	info: AnswerInfo,
) {
	mkdirSync(tracesDir(dir), { recursive: true });
	const day = new Date(info.startedAt).toISOString().slice(0, 10);
	appendFileSync(
		join(tracesDir(dir), `${day}.jsonl`),
		`${JSON.stringify(buildTrace(session, info, settings.traceContent))}\n`,
	);
	if (settings.saveHistory && info.answer !== undefined) {
		mkdirSync(historyDir(dir), { recursive: true });
		// A follow-up rewrites the same file, so one Look stays one entry.
		writeFileSync(
			join(historyDir(dir), `${session.id}.json`),
			JSON.stringify(buildRecord(session)),
		);
	}
	prune(dir, info.endedAt);
}

const files = (path: string) => {
	try {
		return readdirSync(path);
	} catch {
		return []; // not created yet
	}
};

/** Newest first. A broken file is skipped, not fatal. */
export function listHistory(dir: string): HistoryRecord[] {
	const records: HistoryRecord[] = [];
	for (const name of files(historyDir(dir))) {
		try {
			records.push(
				JSON.parse(readFileSync(join(historyDir(dir), name), "utf8")),
			);
		} catch {}
	}
	return records.sort((a, b) => b.id - a.id);
}

/** Deletes one entry, or all of them without an id. The id comes from a renderer: digits only. */
export function deleteHistory(dir: string, id?: unknown) {
	if (id === undefined)
		return rmSync(historyDir(dir), { recursive: true, force: true });
	if (!Number.isSafeInteger(id)) throw new Error("Bad history id");
	rmSync(join(historyDir(dir), `${id}.json`), { force: true });
}

/** Removes history started, and trace days ended, more than 14 days before now. */
export function prune(dir: string, now: number) {
	const cutoff = now - KEEP_MS;
	for (const name of files(historyDir(dir)))
		if (Number.parseInt(name, 10) < cutoff)
			rmSync(join(historyDir(dir), name), { force: true });
	for (const name of files(tracesDir(dir)))
		if (Date.parse(name.slice(0, 10)) + DAY_MS < cutoff)
			rmSync(join(tracesDir(dir), name), { force: true });
}
