// Runs every Look fixture against the real model and prints the answers as markdown.
// Manual only (costs free-tier requests), from the repo root:
//   node --experimental-transform-types --env-file=.env packages/agent/scripts/run-fixtures.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Capture,
	createModelResolver,
	defaultSettings,
	LookError,
	type LookRequest,
	look,
} from "../src/index.ts";

const fixtures = join(import.meta.dirname, "../fixtures/look");

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY missing: run with --env-file=.env");

// One follow-up per run, to check that a follow-up can go deeper than the first answer.
const FOLLOW_UP = {
	file: "chart.png",
	question: "Why might June jump so much?",
};

async function ask(
	capture: Capture,
	conversation: LookRequest["conversation"] = [],
	followUp?: string,
) {
	let fellBack = false;
	const result = look({
		capture,
		conversation,
		followUp,
		settings: defaultSettings,
		getModel: createModelResolver(key as string),
		signal: AbortSignal.timeout(60_000),
		onFallback: () => {
			fellBack = true;
		},
	});
	let text = "";
	try {
		for await (const part of result.textStream) text += part;
	} catch (error) {
		// Only the kind: the full error could carry provider details we don't want in the log.
		text = `**Failed: ${error instanceof LookError ? error.kind : "unknown"}**`;
	}
	return { text, fellBack };
}

for (const file of readdirSync(fixtures).sort()) {
	const path = join(fixtures, file);
	const capture: Capture = file.endsWith(".png")
		? { kind: "region", png: readFileSync(path) }
		: { kind: "text", text: readFileSync(path, "utf8") };
	const first = await ask(capture);
	console.log(
		`## ${file}${first.fellBack ? " (fallback model)" : ""}\n\n${first.text.trim()}\n`,
	);
	if (file !== FOLLOW_UP.file) continue;
	const deeper = await ask(
		capture,
		[{ role: "assistant", content: first.text }],
		FOLLOW_UP.question,
	);
	console.log(
		`### Follow-up: ${FOLLOW_UP.question}${deeper.fellBack ? " (fallback model)" : ""}\n\n${deeper.text.trim()}\n`,
	);
}
