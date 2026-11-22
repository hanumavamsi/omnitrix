// Plumbing: wire the real model + fake tool into your loop and print every turn.
// Run: node --env-file=.env spikes/01-agent-loop/run.ts "What's the weather in Hyderabad and Mumbai?"
import { type CallModel, geminiModel } from "./gemini.ts";
import { runAgent } from "./loop.ts";
import { runTool, toolDeclarations } from "./tools.ts";

const task = process.argv[2] ?? "What's the weather in Hyderabad and Mumbai?";
const model = geminiModel(toolDeclarations);
const traced: CallModel = async (history) => {
	const reply = await model(history);
	console.log(
		`\n--- turn ${Math.ceil(history.length / 2)} ---\n${JSON.stringify(reply.parts, null, 2)}`,
	);
	return reply;
};

console.log(`\nANSWER: ${await runAgent(task, traced, runTool)}`);
