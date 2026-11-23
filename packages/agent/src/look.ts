import {
	APICallError,
	type LanguageModel,
	type ModelMessage,
	RetryError,
	streamText,
	type UserModelMessage,
} from "ai";
import { redact } from "./redact.ts";
import type { Settings } from "./settings.ts";

// Tuned against packages/agent/fixtures/look (results: docs/look-prompt-results.md).
export const LOOK_SYSTEM_PROMPT = `You explain text the user selected, or a region of their screen they captured, in a small panel next to it.

Answer in 2-4 short sentences of markdown. No heading, no preamble, no closing offer of more help. Fit the answer to what was captured:
- Code: say what it does and why you'd use it, not line by line.
- A word or term: define it, then one example or where it's used.
- Math: work it out in brief steps and give the result. Write math as $...$ (KaTeX).
- A table or chart: quote the key numbers (highest, lowest, biggest change) and say the takeaway.
- Text in another language: give the English translation, and name the language.
- Anything else: say what it is and what matters about it.

Follow-up questions may get a longer, deeper answer when the question needs one.`;

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
	/** Called when the main model failed and the fallback model takes over; tag the answer. */
	onFallback?: () => void;
};

export type LookResult = {
	/** Answer text as it streams. Throws a LookError on failure; ends quietly on abort. */
	textStream: AsyncIterable<string>;
	/** How many secrets were replaced with "[redacted secret]" before the model saw the text. */
	redactedCount: number;
};

export type LookErrorKind =
	| "busy"
	| "rate-limit"
	| "daily-limit"
	| "bad-key"
	| "blocked"
	| "network"
	| "aborted"
	| "other";

export class LookError extends Error {
	constructor(
		readonly kind: LookErrorKind,
		cause?: unknown,
	) {
		super(`Look failed: ${kind}`, { cause });
		this.name = "LookError";
	}
}

// A bad key or blocked content fails the same way on any model, so only these get the fallback.
const FALLBACK_KINDS: LookErrorKind[] = [
	"busy",
	"rate-limit",
	"daily-limit",
	"network",
];

export function look(request: LookRequest): LookResult {
	let redactedCount = 0;
	const clean = (text: string) => {
		const result = redact(text);
		redactedCount += result.count;
		return result.text;
	};
	// The capture is always the first user message, so follow-ups keep it (image included).
	// Every text the user typed or selected is cleaned; the image can't be (accepted gap).
	const messages: ModelMessage[] = [
		captureMessage(request.capture, clean),
		...request.conversation.map((message) =>
			message.role === "user" && typeof message.content === "string"
				? { ...message, content: clean(message.content) }
				: message,
		),
	];
	if (request.followUp)
		messages.push({ role: "user", content: clean(request.followUp) });
	return { textStream: withFallback(request, messages), redactedCount };
}

function captureMessage(
	capture: Capture,
	clean: (text: string) => string,
): UserModelMessage {
	if (capture.kind === "text")
		return { role: "user", content: clean(capture.text) };
	const question = capture.question?.trim();
	return {
		role: "user",
		content: [
			{ type: "file", data: capture.png, mediaType: "image/png" },
			{
				type: "text",
				text: question ? clean(question) : DEFAULT_REGION_PROMPT,
			},
		],
	};
}

async function* withFallback(request: LookRequest, messages: ModelMessage[]) {
	let streamedText = false;
	try {
		for await (const text of answer(
			request,
			messages,
			request.settings.lookModel,
		)) {
			streamedText = true;
			yield text;
		}
		return;
	} catch (error) {
		const lookError = toLookError(error, request.signal);
		// Once text is on screen a second model would restart the answer mid-way.
		if (streamedText || !FALLBACK_KINDS.includes(lookError.kind))
			throw lookError;
	}
	request.onFallback?.();
	try {
		yield* answer(request, messages, request.settings.lookFallbackModel);
	} catch (error) {
		throw toLookError(error, request.signal);
	}
}

function answer(
	request: LookRequest,
	messages: ModelMessage[],
	modelId: string,
) {
	const result = streamText({
		model: request.getModel(modelId),
		instructions: LOOK_SYSTEM_PROMPT,
		messages,
		abortSignal: request.signal,
		maxRetries: 1,
		onError: () => {}, // textOf rethrows the error; the SDK's default would also log the raw provider body
	});
	return textOf(result.stream);
}

// The SDK's own textStream swallows errors; this one rethrows them so the HUD can show them.
async function* textOf(
	parts: AsyncIterable<{
		type: string;
		text?: string;
		error?: unknown;
		finishReason?: string;
	}>,
) {
	for await (const part of parts) {
		if (part.type === "text-delta" && part.text) yield part.text;
		else if (part.type === "error") throw part.error;
		// Gemini reports blocked content as a normal finish, not as an error.
		else if (part.type === "finish" && part.finishReason === "content-filter")
			throw new LookError("blocked");
	}
}

// Sorts any failure into a kind the HUD can explain in a few words. See the #5 commit for the SDK details.
function toLookError(error: unknown, signal: AbortSignal): LookError {
	if (error instanceof LookError) return error;
	if (signal.aborted) return new LookError("aborted", error);
	// After its own retry the SDK wraps the attempts in a RetryError; the last attempt says why.
	const cause = RetryError.isInstance(error) ? error.lastError : error;
	if (!APICallError.isInstance(cause)) return new LookError("other", error);
	const status = cause.statusCode;
	const body = cause.responseBody ?? "";
	if (status === undefined) return new LookError("network", error); // fetch failed, no response
	if (status === 401 || status === 403 || body.includes("API_KEY_"))
		return new LookError("bad-key", error);
	// Gemini's 429 body names the quota that ran out, e.g. GenerateRequestsPerDayPerProjectPerModel-FreeTier.
	if (status === 429)
		return new LookError(
			body.includes("PerDay") ? "daily-limit" : "rate-limit",
			error,
		);
	if (status === 408 || status >= 500) return new LookError("busy", error);
	return new LookError("other", error);
}
