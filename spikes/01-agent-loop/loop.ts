// YOU write this file. Goal: make loop.test.ts pass, then try run.ts against real Gemini.
import type { CallModel, Content } from "./gemini.ts";
import type { RunTool } from "./tools.ts";

/**
 * The ReAct loop: ask model -> it either answers (done) or asks for tools -> run them -> repeat.
 *
 * Hints:
 * 1. Start `history` with the user's task: { role: "user", parts: [{ text: task }] }.
 * 2. Loop at most `maxSteps` times (Java: a plain for loop works the same).
 * 3. Each turn: `const reply = await callModel(history)`; push reply onto history.
 * 4. Find tool requests: parts that have a `functionCall` key.
 *    TS narrowing: `"functionCall" in p` tells TS which union member p is (like instanceof).
 * 5. No tool calls? Join the `text` parts and return them. That is the final answer.
 * 6. Tool calls? Run each with `runTool(name, args)`, then push ONE user turn holding a
 *    { functionResponse: { name, response } } part per call, in the same order.
 * 7. Out of steps? throw new Error("max steps reached") so a stuck model cannot loop forever.
 */
export async function runAgent(
	task: string,
	callModel: CallModel,
	runTool: RunTool,
	maxSteps = 5,
): Promise<string> {
	const history: Content[] = [];

	history.push({ role: "user", parts: [{ text: task }] });

	for (let step = 0; step < maxSteps; step++) {
		const reply = await callModel(history);
		history.push(reply);
		// find tool requests: parts that have a `functionCall` key.
		const toolReq = reply.parts.filter((x) => "functionCall" in x);
		if (toolReq.length === 0) {
			// no tool calls? join the `text` parts and return them. that is the final answer.
			return reply.parts
				.filter((x) => "text" in x)
				.map((x) => x.text)
				.join("");
		} else {
			// tool calls? run each with `runTool(name, args)`
			const parts = await Promise.all(
				toolReq.map(async (p) => ({
					functionResponse: {
						name: p.functionCall.name,
						response: await runTool(p.functionCall.name, p.functionCall.args),
					},
				})),
			);
			history.push({ role: "user", parts });
		}}

	throw new Error("max steps reached");
}
