// Omnitrix main process: Ctrl+Shift+Space explains the selected text in the HUD.
import {
	createModelResolver,
	LookError,
	type LookErrorKind,
	look,
} from "@omnitrix/agent";
import { app, globalShortcut, ipcMain } from "electron";
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
let lastText = ""; // what Retry asks about again

// Short, plain HUD text per failure; never the provider's raw message or JSON.
const errorMessages: Record<LookErrorKind, { text: string; retry: boolean }> = {
	busy: { text: "Gemini busy, retry", retry: true },
	"rate-limit": {
		text: "Too many requests, wait a moment and retry",
		retry: true,
	},
	"daily-limit": { text: "Daily free limit reached", retry: false }, // the fallback was tried already
	"bad-key": { text: "Bad API key, open Console", retry: false },
	blocked: { text: "Gemini blocked this content", retry: false },
	network: { text: "No connection to Gemini, retry", retry: true },
	aborted: { text: "Cancelled", retry: true },
	other: { text: "Something went wrong, retry", retry: true },
};

function newLook() {
	inFlight?.abort();
	inFlight = new AbortController();
	return inFlight.signal;
}

async function onHotkey() {
	inFlight?.abort(); // a new press always cancels the old Look
	if (isHudFocused()) return closeHud(); // pressed again while reading: just close

	const signal = newLook();
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
	lastText = text;
	await runLook(text, signal);
}

async function runLook(text: string, signal: AbortSignal) {
	if (!getModel) return;
	try {
		const { textStream } = look({
			capture: { kind: "text", text },
			conversation: [],
			settings,
			getModel,
			signal,
			onFallback: () => sendToHud({ type: "fallback" }),
		});
		for await (const chunk of textStream) {
			if (signal.aborted) return; // drop late chunks
			sendToHud({ type: "chunk", text: chunk });
		}
		if (!signal.aborted) sendToHud({ type: "done" });
	} catch (error) {
		if (signal.aborted) return;
		console.error("Look failed:", error); // the full error stays in the terminal for debugging
		const kind = error instanceof LookError ? error.kind : "other";
		sendToHud({ type: "error", ...errorMessages[kind] });
	}
}

app.whenReady().then(() => {
	setupHud({
		recordable: settings.recordable,
		onClosed: () => inFlight?.abort(),
	});
	ipcMain.on("hud:retry", () => runLook(lastText, newLook())); // runLook catches its own errors
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
