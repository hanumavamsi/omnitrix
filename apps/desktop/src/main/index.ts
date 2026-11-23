// Omnitrix main process: Ctrl+Shift+Space explains the selected text, or a dragged screen region, in the HUD.
import {
	type Capture,
	createModelResolver,
	LookError,
	type LookErrorKind,
	look,
	type ModelMessage,
} from "@omnitrix/agent";
import { app, type Display, globalShortcut, ipcMain } from "electron";
import type { Area } from "../preload/index.ts";
import { captureRegion } from "./capture.ts";
import { openConsole, setupConsole } from "./console.ts";
import {
	closeHud,
	isHudFocused,
	openHud,
	rememberFocus,
	sendToHud,
	setupHud,
	showAnswer,
} from "./hud.ts";
import { getApiKey } from "./keys.ts";
import { grabSelection } from "./selection.ts";
import { getSettings } from "./settings.ts";

let inFlight: AbortController | null = null;
// The open conversation: kept for follow-ups until the panel closes or the hotkey is pressed again.
let session: { capture: Capture; conversation: ModelMessage[] } | null = null;
let lastFollowUp: string | undefined; // with the session, what Retry asks again

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

/** Aborts the old request (a stale answer must never overwrite a new one) and starts a new one. */
function newRequest() {
	inFlight?.abort();
	inFlight = new AbortController();
	return inFlight.signal;
}

async function onHotkey() {
	session = null; // a new press always starts fresh
	if (isHudFocused()) return closeHud(); // pressed again while reading: just close

	const signal = newRequest(); // also cancels the old Look
	rememberFocus();
	const text = await grabSelection();
	if (signal.aborted) return; // an even newer press took over during the grab

	if (!text) return openHud("region");
	openHud("answer");
	session = { capture: { kind: "text", text }, conversation: [] };
	await answer(signal);
}

async function onRegion(display: Display, rect: Area, question: string) {
	const signal = newRequest();
	let png: Buffer;
	try {
		png = await captureRegion(display, rect);
	} catch (error) {
		showAnswer(rect);
		return sendToHud({
			type: "error",
			text: `Capture failed: ${error}`,
			retry: false,
		});
	}
	if (signal.aborted) return;
	showAnswer(rect);
	session = { capture: { kind: "region", png, question }, conversation: [] };
	await answer(signal);
}

async function onFollowUp(text: string) {
	if (!session) return;
	await answer(newRequest(), text);
}

/** Streams one answer of the open session into the HUD and records the turn once it completes. */
async function answer(signal: AbortSignal, followUp?: string) {
	const current = session;
	if (!current) return;
	lastFollowUp = followUp;
	// Read now, not at startup: the Console may have changed the key or settings since.
	const apiKey = getApiKey("google");
	if (!apiKey)
		return sendToHud({
			type: "notice",
			text: "Add API key in Console",
			openConsole: true,
		});

	try {
		const { textStream, redactedCount } = look({
			...current,
			followUp,
			settings: getSettings(),
			getModel: createModelResolver(apiKey),
			signal,
			onFallback: () => sendToHud({ type: "fallback" }),
		});
		if (redactedCount > 0)
			sendToHud({ type: "redacted", count: redactedCount });
		let full = "";
		for await (const chunk of textStream) {
			if (signal.aborted) return; // drop late chunks
			full += chunk;
			sendToHud({ type: "chunk", text: chunk });
		}
		if (signal.aborted) return;
		if (followUp)
			current.conversation.push({ role: "user", content: followUp });
		current.conversation.push({ role: "assistant", content: full });
		sendToHud({ type: "done" });
	} catch (error) {
		if (signal.aborted) return;
		console.error("Look failed:", error); // the full error stays in the terminal for debugging
		const kind = error instanceof LookError ? error.kind : "other";
		sendToHud({
			type: "error",
			...errorMessages[kind],
			openConsole: kind === "bad-key",
		});
	}
}

const logError = (error: unknown) => console.error("Look failed:", error);

app.whenReady().then(() => {
	setupHud({
		recordable: getSettings().recordable,
		onClosed: () => {
			inFlight?.abort();
			session = null;
		},
		onRegion: (display, rect, question) =>
			onRegion(display, rect, question).catch(logError),
		onFollowUp: (text) => onFollowUp(text).catch(logError),
	});
	setupConsole();
	const hasKey = Boolean(getApiKey("google"));
	if (!hasKey) openConsole(); // first run (L12): ask for the key straight away
	// Re-asks the last question of the open session: the same capture (text or region) and follow-up.
	ipcMain.on("hud:retry", () =>
		answer(newRequest(), lastFollowUp).catch(logError),
	);
	const hotkey = () => onHotkey().catch(logError);
	if (!globalShortcut.register("Control+Shift+Space", hotkey))
		console.error("Ctrl+Shift+Space is taken by another app");
	globalShortcut.register("Control+Alt+Escape", () => app.quit()); // kill switch
	console.log(
		`Omnitrix ready (${getSettings().lookModel}${hasKey ? "" : ", no API key"}): press Ctrl+Shift+Space`,
	);
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {}); // keep running in the tray with the Console closed and every HUD hidden
