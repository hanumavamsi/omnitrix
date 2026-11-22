import { describe, expect, it } from "vitest";
import type { CallModel, Content } from "./gemini.ts";
import { runAgent } from "./loop.ts";
import type { RunTool } from "./tools.ts";

// Fake model: returns scripted replies in order and records what it was sent.
function scripted(replies: Content[]) {
	const seen: Content[][] = [];
	const call: CallModel = async (history) => {
		seen.push(structuredClone(history));
		const next = replies.shift();
		if (!next) throw new Error("fake model ran out of replies");
		return next;
	};
	return { call, seen };
}

const weatherCall: Content = {
	role: "model",
	parts: [
		{ functionCall: { name: "get_weather", args: { city: "Hyderabad" } } },
	],
};
const answer = (text: string): Content => ({
	role: "model",
	parts: [{ text }],
});
const fakeTool: RunTool = async () => ({ tempC: 31 });

describe("runAgent", () => {
	it("returns the text when the model answers directly", async () => {
		const m = scripted([answer("hi")]);
		expect(await runAgent("say hi", m.call, fakeTool)).toBe("hi");
		expect(m.seen[0]).toEqual([{ role: "user", parts: [{ text: "say hi" }] }]);
	});

	it("runs a requested tool and sends the result back", async () => {
		const m = scripted([weatherCall, answer("31C and sunny")]);
		const calls: unknown[] = [];
		const tool: RunTool = async (name, args) => {
			calls.push([name, args]);
			return { tempC: 31 };
		};
		expect(await runAgent("weather?", m.call, tool)).toBe("31C and sunny");
		expect(calls).toEqual([["get_weather", { city: "Hyderabad" }]]);
		expect(m.seen[1]?.at(-1)).toEqual({
			role: "user",
			parts: [
				{ functionResponse: { name: "get_weather", response: { tempC: 31 } } },
			],
		});
	});

	it("stops after maxSteps if the model never answers", async () => {
		const m = scripted([weatherCall, weatherCall, weatherCall]);
		await expect(runAgent("loop", m.call, fakeTool, 3)).rejects.toThrow(
			"max steps",
		);
	});
});
