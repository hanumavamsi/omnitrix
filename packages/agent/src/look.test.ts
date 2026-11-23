import { APICallError, type ModelMessage, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import {
	type Capture,
	DEFAULT_REGION_PROMPT,
	LOOK_SYSTEM_PROMPT,
	LookError,
	look,
} from "./look.ts";
import { REDACTED } from "./redact.ts";
import { defaultSettings } from "./settings.ts";

const usage = {
	inputTokens: {
		total: 5,
		noCache: 5,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 3, text: 3, reasoning: undefined },
};

// A mock model that streams the given words, chunkDelayInMs apart.
function streamingModel(words: string[], chunkDelayInMs = 0) {
	return new MockLanguageModelV4({
		doStream: async () => ({
			stream: simulateReadableStream({
				chunkDelayInMs,
				chunks: [
					{ type: "text-start", id: "t" },
					...words.map((delta) => ({
						type: "text-delta" as const,
						id: "t",
						delta,
					})),
					{ type: "text-end", id: "t" },
					{
						type: "finish",
						finishReason: { unified: "stop", raw: undefined },
						usage,
					},
				],
			}),
		}),
	});
}

// Shaped like what @ai-sdk/google throws for an HTTP error. retry-after-ms 0 keeps the SDK retry instant.
function apiError(statusCode: number, responseBody = "{}") {
	return new APICallError({
		message: `HTTP ${statusCode}`,
		url: "https://example.test",
		requestBodyValues: {},
		statusCode,
		responseHeaders: { "retry-after-ms": "0" },
		responseBody,
	});
}

// A mock model that fails with the given errors first, then streams "ok".
function failingModel(...errors: Error[]) {
	let calls = 0;
	const ok = streamingModel(["ok"]);
	return new MockLanguageModelV4({
		doStream: async (options) => {
			const error = errors[calls++];
			if (error) throw error;
			return ok.doStream(options);
		},
	});
}

function lookWith(
	model: MockLanguageModelV4,
	{
		signal = new AbortController().signal,
		text = "const x = 1;",
		capture = { kind: "text", text } as Capture,
		conversation = [] as ModelMessage[],
		followUp = undefined as string | undefined,
		fallback = model,
	} = {},
) {
	const asked: string[] = [];
	let fellBack = false;
	const result = look({
		capture,
		conversation,
		followUp,
		settings: defaultSettings,
		getModel: (id) => {
			asked.push(id);
			return id === defaultSettings.lookFallbackModel ? fallback : model;
		},
		signal,
		onFallback: () => {
			fellBack = true;
		},
	});
	return { ...result, asked, fellBack: () => fellBack };
}

async function lookErrorOf(stream: AsyncIterable<string>) {
	const error = await collect(stream).catch((e: unknown) => e);
	expect(error).toBeInstanceOf(LookError);
	return error as LookError;
}

async function collect(stream: AsyncIterable<string>) {
	const chunks: string[] = [];
	for await (const chunk of stream) chunks.push(chunk);
	return chunks;
}

describe("look", () => {
	it("sends the system prompt and the capture to the Look model", async () => {
		const model = streamingModel(["ok"]);
		const { textStream, asked } = lookWith(model);
		await collect(textStream);

		expect(asked).toEqual([defaultSettings.lookModel]);
		const prompt = model.doStreamCalls[0]?.prompt;
		expect(prompt).toEqual([
			{ role: "system", content: LOOK_SYSTEM_PROMPT },
			{ role: "user", content: [{ type: "text", text: "const x = 1;" }] },
		]);
	});

	const png = new Uint8Array([137, 80, 78, 71]);

	async function promptFor(capture: Capture) {
		const model = streamingModel(["ok"]);
		await collect(lookWith(model, { capture }).textStream);
		return model.doStreamCalls[0]?.prompt;
	}

	it("sends a region as an image part plus the question", async () => {
		const prompt = await promptFor({
			kind: "region",
			png,
			question: "What is the max?",
		});
		expect(prompt?.[1]).toMatchObject({
			role: "user",
			content: [
				{ type: "file", mediaType: "image/png", data: { data: png } },
				{ type: "text", text: "What is the max?" },
			],
		});
	});

	it("uses the default explain prompt when the region question is empty", async () => {
		const prompt = await promptFor({ kind: "region", png, question: "  " });
		expect(prompt?.[1]?.content).toContainEqual(
			expect.objectContaining({ type: "text", text: DEFAULT_REGION_PROMPT }),
		);
	});

	it("carries the capture and earlier turns into a follow-up", async () => {
		const model = streamingModel(["ok"]);
		const { textStream } = lookWith(model, {
			capture: { kind: "region", png },
			conversation: [{ role: "assistant", content: "A bar chart." }],
			followUp: "Which bar is tallest?",
		});
		await collect(textStream);

		const prompt = model.doStreamCalls[0]?.prompt;
		expect(prompt?.map((m) => m.role)).toEqual([
			"system",
			"user",
			"assistant",
			"user",
		]);
		expect(prompt?.[1]?.content).toContainEqual(
			expect.objectContaining({
				type: "file",
				data: { type: "data", data: png },
			}),
		);
		expect(prompt?.[2]).toMatchObject({
			content: [{ type: "text", text: "A bar chart." }],
		});
		expect(prompt?.[3]).toMatchObject({
			content: [{ type: "text", text: "Which bar is tallest?" }],
		});
	});

	it("streams the answer to the caller chunk by chunk", async () => {
		const { textStream } = lookWith(streamingModel(["It ", "declares ", "x."]));
		expect(await collect(textStream)).toEqual(["It ", "declares ", "x."]);
	});

	it("reports the token counts for the trace", async () => {
		let reported: unknown;
		const { textStream } = look({
			capture: { kind: "text", text: "x" },
			conversation: [],
			settings: defaultSettings,
			getModel: () => streamingModel(["ok"]),
			signal: new AbortController().signal,
			onUsage: (usage) => {
				reported = usage;
			},
		});
		await collect(textStream);
		expect(reported).toMatchObject({ inputTokens: 5, outputTokens: 3 });
	});

	it("stops streaming when aborted", async () => {
		const controller = new AbortController();
		const words = Array.from({ length: 20 }, (_, i) => `w${i} `);
		const { textStream } = lookWith(streamingModel(words, 10), {
			signal: controller.signal,
		});

		const chunks: string[] = [];
		for await (const chunk of textStream) {
			chunks.push(chunk);
			if (chunks.length === 2) controller.abort();
		}
		expect(chunks.length).toBeLessThan(words.length);
	});

	it("retries once when the model is busy", async () => {
		const model = failingModel(apiError(503));
		const { textStream, asked, fellBack } = lookWith(model);
		expect(await collect(textStream)).toEqual(["ok"]);
		expect(model.doStreamCalls).toHaveLength(2);
		expect(asked).toEqual([defaultSettings.lookModel]);
		expect(fellBack()).toBe(false);
	});

	it("lets the fallback model answer when the model is busy twice", async () => {
		const main = failingModel(apiError(503), apiError(503));
		const fallback = streamingModel(["from ", "fallback"]);
		const { textStream, asked, fellBack } = lookWith(main, { fallback });
		expect(await collect(textStream)).toEqual(["from ", "fallback"]);
		expect(asked).toEqual([
			defaultSettings.lookModel,
			defaultSettings.lookFallbackModel,
		]);
		expect(fellBack()).toBe(true);
	});

	it("throws a typed error when both models fail", async () => {
		const busy = () => failingModel(apiError(503), apiError(503));
		const error = await lookErrorOf(
			lookWith(busy(), { fallback: busy() }).textStream,
		);
		expect(error.kind).toBe("busy");
	});

	it("does not try the fallback on a bad key", async () => {
		const badKey = apiError(
			400,
			'{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}',
		);
		const main = failingModel(badKey);
		const fallback = streamingModel(["never"]);
		const { textStream, asked, fellBack } = lookWith(main, { fallback });
		expect((await lookErrorOf(textStream)).kind).toBe("bad-key");
		expect(main.doStreamCalls).toHaveLength(1); // a 400 is not retried either
		expect(asked).toEqual([defaultSettings.lookModel]);
		expect(fellBack()).toBe(false);
	});

	const network = new APICallError({
		message: "Cannot connect to API",
		url: "https://example.test",
		requestBodyValues: {},
		isRetryable: true,
		responseHeaders: { "retry-after-ms": "0" },
	});
	it.each([
		[
			"rate-limit",
			apiError(
				429,
				'{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}',
			),
		],
		[
			"daily-limit",
			apiError(
				429,
				'{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}',
			),
		],
		["network", network],
		["other", new Error("something odd")],
	])("sorts a %s failure into its kind", async (kind, cause) => {
		const model = () => failingModel(cause, cause);
		const error = await lookErrorOf(
			lookWith(model(), { fallback: model() }).textStream,
		);
		expect(error.kind).toBe(kind);
	});

	it("reports blocked content without trying the fallback", async () => {
		const blocked = new MockLanguageModelV4({
			doStream: async () => ({
				stream: simulateReadableStream({
					chunks: [
						{
							type: "finish" as const,
							finishReason: {
								unified: "content-filter" as const,
								raw: "SAFETY",
							},
							usage,
						},
					],
				}),
			}),
		});
		const { textStream, fellBack } = lookWith(blocked);
		expect((await lookErrorOf(textStream)).kind).toBe("blocked");
		expect(fellBack()).toBe(false);
	});

	it("sends only redacted text to the model and reports the count", async () => {
		const model = streamingModel(["ok"]);
		const fakeKey = `AIza${"FAKE".repeat(8)}abc`;
		const { textStream, redactedCount } = lookWith(model, {
			text: `PASSWORD=hunter2
key = ${fakeKey}`,
			conversation: [{ role: "user", content: "DB_TOKEN=abc" }],
		});
		await collect(textStream);

		expect(redactedCount).toBe(3);
		const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
		expect(prompt).not.toContain("hunter2");
		expect(prompt).not.toContain(fakeKey);
		expect(prompt).toContain(`PASSWORD=${REDACTED}`);
		expect(prompt).toContain(`DB_TOKEN=${REDACTED}`);
	});

	it("redacts a region question and a follow-up too", async () => {
		const model = streamingModel(["ok"]);
		const { textStream, redactedCount } = lookWith(model, {
			capture: { kind: "region", png, question: "PASSWORD=hunter2" },
			followUp: "SECRET=swordfish",
		});
		await collect(textStream);

		expect(redactedCount).toBe(2);
		const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
		expect(prompt).not.toContain("hunter2");
		expect(prompt).not.toContain("swordfish");
	});

	it("reports zero when nothing needs redacting", () => {
		expect(lookWith(streamingModel(["ok"])).redactedCount).toBe(0);
	});
});
