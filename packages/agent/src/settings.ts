// User settings. The desktop app stores them in %APPDATA%\omnitrix\settings.json.
// Model ids use the "provider:model" format (D4). API keys never go in here (D17).
export type Settings = {
	lookModel: string;
	lookFallbackModel: string;
	actModel: string;
	actFallbackModel: string;
	panelPosition: "cursor" | "fixed";
	saveHistory: boolean;
	traceContent: boolean;
	recordable: boolean;
};

export const defaultSettings: Settings = {
	lookModel: "google:gemini-flash-lite-latest",
	lookFallbackModel: "google:gemini-flash-latest",
	actModel: "google:gemini-flash-latest",
	actFallbackModel: "google:gemini-flash-lite-latest",
	panelPosition: "cursor",
	saveHistory: true,
	traceContent: false,
	recordable: false,
};

const isModelId = (value: unknown) =>
	typeof value === "string" && /^[a-z0-9-]+:\S+$/.test(value);
const isBoolean = (value: unknown) => typeof value === "boolean";

// One check per setting; the mapped type makes the compiler flag a setting without one.
const validators: { [K in keyof Settings]: (value: unknown) => boolean } = {
	lookModel: isModelId,
	lookFallbackModel: isModelId,
	actModel: isModelId,
	actFallbackModel: isModelId,
	panelPosition: (value) => value === "cursor" || value === "fixed",
	saveHistory: isBoolean,
	traceContent: isBoolean,
	recordable: isBoolean,
};

/**
 * Checks settings from an untrusted source (the settings file, the Console page).
 * Missing settings get their default, unknown ones are dropped, a wrong value throws.
 */
export function parseSettings(raw: unknown): Settings {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		throw new Error("Settings must be an object");
	const input = raw as Record<string, unknown>;
	const result: Record<string, unknown> = { ...defaultSettings };
	for (const [key, isValid] of Object.entries(validators)) {
		if (input[key] === undefined) continue;
		if (!isValid(input[key])) throw new Error(`Invalid value for ${key}`);
		result[key] = input[key];
	}
	return result as Settings;
}
