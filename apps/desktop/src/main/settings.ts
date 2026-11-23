import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSettings, type Settings } from "@omnitrix/agent";
import { app } from "electron";

/** Reads %APPDATA%\omnitrix\settings.json, creating it with defaults on first run. */
export function loadSettings(): Settings {
	const dir = join(app.getPath("appData"), "omnitrix");
	const file = join(dir, "settings.json");
	if (!existsSync(file)) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, JSON.stringify(defaultSettings, null, "\t"));
		return { ...defaultSettings };
	}
	// Missing keys (older file) fall back to defaults.
	return { ...defaultSettings, ...JSON.parse(readFileSync(file, "utf8")) };
}

/** Dev only: the key comes from GEMINI_API_KEY or the repo's git-ignored .env. The Console replaces this (#6). */
export function loadApiKey(): string | undefined {
	if (!process.env.GEMINI_API_KEY && !app.isPackaged) {
		try {
			process.loadEnvFile(join(app.getAppPath(), "..", "..", ".env"));
		} catch {} // no .env: fine, the HUD says the key is missing
	}
	return process.env.GEMINI_API_KEY || undefined;
}
