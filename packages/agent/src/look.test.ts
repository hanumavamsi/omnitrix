import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import {
	type Capture,
	DEFAULT_REGION_PROMPT,
	LOOK_SYSTEM_PROMPT,
	look,
} from "./look.ts";
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
	extra: Partial<Parameters<typeof look>[0]> = {},
) {
	const asked: string[] = [];
	const result = look({
		capture: { kind: "text", text: "const x = 1;" },
		conversation: [],
		settings: defaultSettings,
		...extra,
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

	const png = new Uint8Array([137, 80, 78, 71]);

	async function promptFor(capture: Capture) {
		const model = streamingModel(["ok"]);
		await collect(lookWith(model, undefined, { capture }).textStream);
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
		const { textStream } = lookWith(model, undefined, {
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
});
