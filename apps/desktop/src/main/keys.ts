// API keys per provider (D17): encrypted with safeStorage (DPAPI on Windows) in one file, never in settings.json.
// An env var overrides the stored key, for dev.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import type { KeyState, ProviderView } from "../preload/console.ts";
import { dataDir } from "./settings.ts";

// To add a provider: add it here and to createModelResolver in @omnitrix/agent.
export const providers = [
	{
		id: "google",
		name: "Google Gemini",
		envVar: "GEMINI_API_KEY",
		keyUrl: "https://aistudio.google.com/apikey",
		warning:
			"Free-tier Gemini keys may let Google use what you send to train its models. Use a paid key or another provider for private content.",
	},
];

const file = join(dataDir, "keys.bin");

// Dev only: pick up GEMINI_API_KEY from the repo's git-ignored .env.
if (!app.isPackaged) {
	try {
		process.loadEnvFile(join(app.getAppPath(), "..", "..", ".env"));
	} catch {} // no .env: fine
}

// Only main ever holds the decrypted keys. safeStorage works only after app "ready".
function readStore(): Record<string, string> {
	if (!existsSync(file)) return {};
	try {
		return JSON.parse(safeStorage.decryptString(readFileSync(file)));
	} catch (error) {
		console.error("Could not decrypt the stored API keys:", error);
		return {};
	}
}

function writeStore(store: Record<string, string>) {
	if (!safeStorage.isEncryptionAvailable())
		throw new Error("Encryption is not available, so the key was not saved");
	mkdirSync(dataDir, { recursive: true });
	writeFileSync(file, safeStorage.encryptString(JSON.stringify(store)));
}

function findProvider(id: unknown) {
	const provider = providers.find((p) => p.id === id);
	if (!provider) throw new Error(`Unknown provider ${String(id)}`);
	return provider;
}

export function getApiKey(providerId: string): string | undefined {
	const provider = findProvider(providerId);
	return process.env[provider.envVar] || readStore()[provider.id] || undefined;
}

/** Validates the provider and key (both come from a renderer), then stores the key encrypted. */
export function setApiKey(providerId: unknown, key: unknown) {
	const provider = findProvider(providerId);
	const trimmed = typeof key === "string" ? key.trim() : "";
	if (!trimmed || trimmed.length > 500 || /\s/.test(trimmed))
		throw new Error("That does not look like an API key");
	writeStore({ ...readStore(), [provider.id]: trimmed });
}

export function clearApiKey(providerId: unknown) {
	const provider = findProvider(providerId);
	const { [provider.id]: _removed, ...rest } = readStore();
	writeStore(rest);
}

/** What the Console may know about each provider: whether a key exists, never the key itself. */
export function providerViews(): ProviderView[] {
	const store = readStore();
	return providers.map((p) => {
		let key: KeyState = "none";
		if (process.env[p.envVar]) key = "env";
		else if (store[p.id]) key = "saved";
		return {
			id: p.id,
			name: p.name,
			envVar: p.envVar,
			warning: p.warning,
			key,
		};
	});
}
