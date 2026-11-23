import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSettings, parseSettings, type Settings } from "@omnitrix/agent";
import { app } from "electron";

/** %APPDATA%\omnitrix: settings.json and the encrypted keys live here. */
export const dataDir = join(app.getPath("appData"), "omnitrix");
const file = join(dataDir, "settings.json");

let current = loadSettings();

function loadSettings(): Settings {
	if (!existsSync(file)) return writeSettings(defaultSettings);
	try {
		return parseSettings(JSON.parse(readFileSync(file, "utf8")));
	} catch (error) {
		// Left on disk untouched so the user can fix it; the next save from the Console overwrites it.
		console.error(`Bad ${file}, using defaults:`, error);
		return { ...defaultSettings };
	}
}

function writeSettings(settings: Settings): Settings {
	mkdirSync(dataDir, { recursive: true });
	writeFileSync(file, JSON.stringify(settings, null, "\t"));
	return { ...settings };
}

/** Read this at use time, not once at startup: the Console can change it any moment. */
export function getSettings(): Settings {
	return current;
}

/** Validates (the input comes from a renderer), saves and returns the new settings. Throws on a bad value. */
export function saveSettings(raw: unknown): Settings {
	current = writeSettings(parseSettings(raw));
	return current;
}
