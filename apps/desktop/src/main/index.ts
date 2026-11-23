// Omnitrix main process: Ctrl+Shift+Space explains the selected text in the HUD.
import { createModelResolver, look } from "@omnitrix/agent";
import { app, globalShortcut } from "electron";
import {
	closeHud,
	isHudFocused,
	openHud,
	rememberFocus,
	sendToHud,
	setupHud,
} from "./hud.ts";
import { grabSelection } from "./selection.ts";
import { loadApiKey, loadSettings } from "./settings.ts";

const settings = loadSettings();
const apiKey = loadApiKey();
const getModel = apiKey ? createModelResolver(apiKey) : undefined;

let inFlight: AbortController | null = null;

async function onHotkey() {
	inFlight?.abort(); // a new press always cancels the old Look
	if (isHudFocused()) return closeHud(); // pressed again while reading: just close

	const controller = new AbortController();
	inFlight = controller;
	const { signal } = controller;
	rememberFocus();
	const text = await grabSelection();
	if (signal.aborted) return; // an even newer press took over during the grab

	openHud();
	// shortcut: no selection shows a notice; #4 turns this into region capture.
	if (!text) return sendToHud({ type: "notice", text: "Select text first" });
	if (!getModel)
		return sendToHud({
			type: "notice",
			text: "No API key: set GEMINI_API_KEY in .env",
		});

	try {
		const { textStream, redactedCount } = look({
			capture: { kind: "text", text },
			conversation: [],
			settings,
			getModel,
			signal,
		});
		if (redactedCount > 0)
			sendToHud({ type: "redacted", count: redactedCount });
		for await (const chunk of textStream) {
			if (signal.aborted) return; // drop late chunks
			sendToHud({ type: "chunk", text: chunk });
		}
		if (!signal.aborted) sendToHud({ type: "done" });
	} catch (error) {
		// shortcut: raw message for now; #5 maps errors to short plain text.
		if (!signal.aborted)
			sendToHud({
				type: "error",
				text: error instanceof Error ? error.message : String(error),
			});
	}
}

app.whenReady().then(() => {
	setupHud({
		recordable: settings.recordable,
		onClosed: () => inFlight?.abort(),
	});
	const hotkey = () =>
		onHotkey().catch((error) => console.error("Look failed:", error));
	if (!globalShortcut.register("Control+Shift+Space", hotkey))
		console.error("Ctrl+Shift+Space is taken by another app");
	globalShortcut.register("Control+Alt+Escape", () => app.quit()); // kill switch
	console.log(
		`Omnitrix ready (${settings.lookModel}${apiKey ? "" : ", no API key"}): select text, press Ctrl+Shift+Space`,
	);
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {}); // keep running with every HUD hidden
