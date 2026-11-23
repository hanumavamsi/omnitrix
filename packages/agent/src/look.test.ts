import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { LOOK_SYSTEM_PROMPT, LookError, look } from "./look.ts";
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
	signal = new AbortController().signal,
	fallback = model,
) {
	const asked: string[] = [];
	let fellBack = false;
	const result = look({
		capture: { kind: "text", text: "const x = 1;" },
		conversation: [],
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

	it("streams the answer to the caller chunk by chunk", async () => {
		const { textStream } = lookWith(streamingModel(["It ", "declares ", "x."]));
		expect(await collect(textStream)).toEqual(["It ", "declares ", "x."]);
	});

	it("stops streaming when aborted", async () => {
		const controller = new AbortController();
		const words = Array.from({ length: 20 }, (_, i) => `w${i} `);
		const { textStream } = lookWith(
			streamingModel(words, 10),
			controller.signal,
		);

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
		const { textStream, asked, fellBack } = lookWith(main, undefined, fallback);
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
			lookWith(busy(), undefined, busy()).textStream,
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
		const { textStream, asked, fellBack } = lookWith(main, undefined, fallback);
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
			lookWith(model(), undefined, model()).textStream,
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
});
