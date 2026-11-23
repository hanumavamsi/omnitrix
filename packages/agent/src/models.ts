import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

// Turns a "provider:model" id into an AI SDK model. Only Google for now (D4 default).
export function createModelResolver(googleApiKey: string) {
	const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
	return (id: string): LanguageModel => {
		const [provider, name] = id.split(":", 2);
		if (provider === "google" && name) return google(name);
		throw new Error(
			`Unknown model "${id}": use provider:model, e.g. google:gemini-flash-latest`,
		);
	};
}
