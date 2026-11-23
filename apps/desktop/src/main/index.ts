// Omnitrix main process: Ctrl+Shift+Space explains the selected text in the HUD.
import {
	createModelResolver,
	LookError,
	type LookErrorKind,
	look,
} from "@omnitrix/agent";
import { app, globalShortcut, ipcMain } from "electron";
import { openConsole, setupConsole } from "./console.ts";
import {
	closeHud,
	isHudFocused,
	openHud,
	rememberFocus,
	sendToHud,
	setupHud,
} from "./hud.ts";
import { getApiKey } from "./keys.ts";
import { grabSelection } from "./selection.ts";
import { getSettings } from "./settings.ts";

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
	// Read now, not at startup: the Console may have changed the key or settings since.
	const apiKey = getApiKey("google");
	if (!apiKey)
		return sendToHud({
			type: "notice",
			text: "Add API key in Console",
			openConsole: true,
		});
	// shortcut: no selection shows a notice; #4 turns this into region capture.
	if (!text) return sendToHud({ type: "notice", text: "Select text first" });
	lastText = text;
	await runLook(text, apiKey, signal);
}

async function runLook(text: string, apiKey: string, signal: AbortSignal) {
	try {
		const { textStream, redactedCount } = look({
			capture: { kind: "text", text },
			conversation: [],
			settings: getSettings(),
			getModel: createModelResolver(apiKey),
			signal,
			onFallback: () => sendToHud({ type: "fallback" }),
		});
		if (redactedCount > 0)
			sendToHud({ type: "redacted", count: redactedCount });
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
		recordable: getSettings().recordable,
		onClosed: () => inFlight?.abort(),
	});
	setupConsole();
	const hasKey = Boolean(getApiKey("google"));
	if (!hasKey) openConsole(); // first run (L12): ask for the key straight away
	ipcMain.on("hud:retry", () => {
		const apiKey = getApiKey("google");
		if (apiKey) runLook(lastText, apiKey, newLook()); // runLook catches its own errors
	});
	const hotkey = () =>
		onHotkey().catch((error) => console.error("Look failed:", error));
	if (!globalShortcut.register("Control+Shift+Space", hotkey))
		console.error("Ctrl+Shift+Space is taken by another app");
	globalShortcut.register("Control+Alt+Escape", () => app.quit()); // kill switch
	console.log(
		`Omnitrix ready (${getSettings().lookModel}${hasKey ? "" : ", no API key"}): select text, press Ctrl+Shift+Space`,
	);
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {}); // keep running in the tray with the Console closed and every HUD hidden
