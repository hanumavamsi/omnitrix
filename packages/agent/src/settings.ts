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
