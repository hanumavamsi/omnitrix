// Plumbing: one fake tool. Canned data, so the spike is about the loop, not the weather.
import type { ToolDeclaration } from "./gemini.ts";

export type RunTool = (
	name: string,
	args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export const toolDeclarations: ToolDeclaration[] = [
	{
		name: "get_weather",
		description: "Current weather for a city.",
		parameters: {
			type: "object",
			properties: {
				city: { type: "string", description: "City name, e.g. Hyderabad" },
			},
			required: ["city"],
		},
	},
];

const fakeWeather: Record<string, { tempC: number; sky: string }> = {
	hyderabad: { tempC: 31, sky: "sunny" },
	mumbai: { tempC: 29, sky: "humid, light rain" },
};

export const runTool: RunTool = async (name, args) => {
	if (name !== "get_weather") return { error: `unknown tool ${name}` };
	const city = String(args.city ?? "").toLowerCase();
	return fakeWeather[city] ?? { error: `no data for ${city}` };
};
