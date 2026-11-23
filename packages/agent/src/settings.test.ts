import { describe, expect, it } from "vitest";
import { defaultSettings, parseSettings } from "./settings.ts";

describe("parseSettings", () => {
	it("fills missing settings with defaults", () => {
		expect(parseSettings({ recordable: true })).toEqual({
			...defaultSettings,
			recordable: true,
		});
	});

	it("drops unknown keys, so nothing extra reaches the settings file", () => {
		expect(parseSettings({ apiKey: "secret" })).toEqual(defaultSettings);
	});

	it("accepts any provider:model id", () => {
		expect(parseSettings({ actModel: "openai:gpt-5" }).actModel).toBe(
			"openai:gpt-5",
		);
	});

	it.each([
		["lookModel", "gemini-flash"],
		["lookModel", ""],
		["actFallbackModel", 42],
		["panelPosition", "top"],
		["saveHistory", "yes"],
		["recordable", 1],
	])("rejects %s = %j", (key, value) => {
		expect(() => parseSettings({ [key]: value })).toThrow(key);
	});

	it.each([null, [], "x"])("rejects a non-object (%j)", (raw) => {
		expect(() => parseSettings(raw)).toThrow("object");
	});
});
