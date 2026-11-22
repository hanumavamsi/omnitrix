// Plumbing: one raw HTTP call to Gemini. No SDK on purpose (spike 1 = see the wire format).

export type Part =
	| { text: string }
	| { functionCall: { name: string; args: Record<string, unknown> } }
	| { functionResponse: { name: string; response: Record<string, unknown> } };

export type Content = { role: "user" | "model"; parts: Part[] };

export type ToolDeclaration = {
	name: string;
	description: string;
	parameters: Record<string, unknown>; // JSON Schema subset
};

// The loop only depends on this type, so tests can pass a fake model.
export type CallModel = (history: Content[]) => Promise<Content>;

export function geminiModel(tools: ToolDeclaration[]): CallModel {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey)
		throw new Error(
			"GEMINI_API_KEY missing: put it in .env (never in code or chat)",
		);
	const model = (
		process.env.OMNITRIX_MODEL ?? "google:gemini-flash-latest"
	).replace(/^google:/, "");
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

	return async (history) => {
		let res: Response;
		// 503 overloaded / 429 rate limit are temporary: retry 1s, 2s, 4s, then give up.
		for (let attempt = 0; ; attempt++) {
			res = await fetch(url, {
				method: "POST",
				signal: AbortSignal.timeout(30_000), // overloaded server can hang the socket
				// Key in a header, not the URL, so it never lands in logs.
				headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
				body: JSON.stringify({
					contents: history,
					tools: [{ functionDeclarations: tools }],
				}),
			});
			if ((res.status !== 503 && res.status !== 429) || attempt === 3) break;
			console.warn(`Gemini ${res.status}, retry ${attempt + 1}/3`);
			await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
		}
		if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
		const data = (await res.json()) as { candidates?: { content?: Content }[] };
		const content = data.candidates?.[0]?.content;
		if (!content)
			throw new Error(`Gemini returned no content: ${JSON.stringify(data)}`);
		return { role: "model", parts: content.parts ?? [] };
	};
}
