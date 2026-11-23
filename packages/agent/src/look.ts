import {
	type LanguageModel,
	type ModelMessage,
	streamText,
	type UserModelMessage,
} from "ai";
import type { Settings } from "./settings.ts";

// Placeholder: ticket #8 tunes this against fixture captures.
export const LOOK_SYSTEM_PROMPT =
	"You explain text the user selected, or a region of their screen they captured. Answer in 2-4 short sentences, in markdown.";

/** Sent with a region when the user pressed Enter without a question. */
export const DEFAULT_REGION_PROMPT =
	"Explain what is shown in this screenshot.";

export type Capture =
	| { kind: "text"; text: string }
	| { kind: "region"; png: Uint8Array; question?: string };

export type LookRequest = {
	capture: Capture;
	/** Turns after the capture (answers and follow-ups so far); empty on a fresh hotkey press. */
	conversation: ModelMessage[];
	/** The follow-up question, when this call asks one. */
	followUp?: string;
	settings: Settings;
	/** Resolves a "provider:model" id. Injected so tests can pass mock models. */
	getModel: (id: string) => LanguageModel;
	signal: AbortSignal;
};

export type LookResult = {
	/** Answer text as it streams. Throws on a model error; ends quietly on abort. */
	textStream: AsyncIterable<string>;
};

export function look(request: LookRequest): LookResult {
	const messages: ModelMessage[] = [
		captureMessage(request.capture),
		...request.conversation,
	];
	if (request.followUp)
		messages.push({ role: "user", content: request.followUp });
	const result = streamText({
		model: request.getModel(request.settings.lookModel),
		instructions: LOOK_SYSTEM_PROMPT,
		messages,
		abortSignal: request.signal,
		maxRetries: 1,
	});
	return { textStream: textOf(result.stream) };
}

// The capture is always the first user message, so follow-ups keep it (image included).
function captureMessage(capture: Capture): UserModelMessage {
	if (capture.kind === "text") return { role: "user", content: capture.text };
	return {
		role: "user",
		content: [
			{ type: "file", data: capture.png, mediaType: "image/png" },
			{ type: "text", text: capture.question?.trim() || DEFAULT_REGION_PROMPT },
		],
	};
}

// The SDK's own textStream swallows errors; this one rethrows them so the HUD can show them.
async function* textOf(
	parts: AsyncIterable<{ type: string; text?: string; error?: unknown }>,
) {
	for await (const part of parts) {
		if (part.type === "text-delta" && part.text) yield part.text;
		else if (part.type === "error") throw part.error;
	}
}
