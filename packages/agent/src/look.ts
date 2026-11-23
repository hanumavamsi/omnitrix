import { type LanguageModel, type ModelMessage, streamText } from "ai";
import type { Settings } from "./settings.ts";

// Placeholder: ticket #8 tunes this against fixture captures.
export const LOOK_SYSTEM_PROMPT =
	"You explain text the user selected on their screen. Answer in 2-4 short sentences.";

export type Capture = { kind: "text"; text: string };

export type LookRequest = {
	capture: Capture;
	/** Earlier turns of this conversation; empty on a fresh hotkey press. */
	conversation: ModelMessage[];
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
	const result = streamText({
		model: request.getModel(request.settings.lookModel),
		instructions: LOOK_SYSTEM_PROMPT,
		messages: [
			...request.conversation,
			{ role: "user", content: request.capture.text },
		],
		abortSignal: request.signal,
		maxRetries: 1,
	});
	return { textStream: textOf(result.stream) };
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
