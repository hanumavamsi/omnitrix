import { type ModelMessage, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { LOOK_SYSTEM_PROMPT, look } from "./look.ts";
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

function lookWith(
	model: MockLanguageModelV4,
	signal = new AbortController().signal,
	text = "const x = 1;",
	conversation: ModelMessage[] = [],
) {
	const asked: string[] = [];
	const result = look({
		capture: { kind: "text", text },
		conversation,
		settings: defaultSettings,
		getModel: (id) => {
			asked.push(id);
			return model;
		},
		signal,
	});
	return { ...result, asked };
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

	it("throws model errors instead of ending silently", async () => {
		const model = new MockLanguageModelV4({
			doStream: async () => {
				throw new Error("bad key");
			},
		});
		await expect(collect(lookWith(model).textStream)).rejects.toThrow(
			"bad key",
		);
	});

	it("sends only redacted text to the model and reports the count", async () => {
		const model = streamingModel(["ok"]);
		const fakeKey = `AIza${"FAKE".repeat(8)}abc`;
		const { textStream, redactedCount } = lookWith(
			model,
			undefined,
			`PASSWORD=hunter2
key = ${fakeKey}`,
			[{ role: "user", content: "DB_TOKEN=abc" }],
		);
		await collect(textStream);

		expect(redactedCount).toBe(3);
		const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
		expect(prompt).not.toContain("hunter2");
		expect(prompt).not.toContain(fakeKey);
		expect(prompt).toContain(`PASSWORD=${REDACTED}`);
		expect(prompt).toContain(`DB_TOKEN=${REDACTED}`);
	});

	it("reports zero when nothing needs redacting", () => {
		expect(lookWith(streamingModel(["ok"])).redactedCount).toBe(0);
	});
});
