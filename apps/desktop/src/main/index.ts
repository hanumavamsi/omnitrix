// Omnitrix main process: Ctrl+Shift+Space explains the selected text, or a dragged screen region, in the HUD.
import {
	type Capture,
	createModelResolver,
	look,
	type ModelMessage,
} from "@omnitrix/agent";
import { app, type Display, globalShortcut } from "electron";
import type { Area } from "../preload/index.ts";
import { captureRegion } from "./capture.ts";
import {
	closeHud,
	isHudFocused,
	openHud,
	rememberFocus,
	sendToHud,
	setupHud,
	showAnswer,
} from "./hud.ts";
import { grabSelection } from "./selection.ts";
import { loadApiKey, loadSettings } from "./settings.ts";

const settings = loadSettings();
const apiKey = loadApiKey();
const getModel = apiKey ? createModelResolver(apiKey) : undefined;

let inFlight: AbortController | null = null;
// The open conversation: kept for follow-ups until the panel closes or the hotkey is pressed again.
let session: { capture: Capture; conversation: ModelMessage[] } | null = null;

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
		return sendToHud({ type: "error", text: `Capture failed: ${error}` });
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
	if (!getModel)
		return sendToHud({
			type: "notice",
			text: "No API key: set GEMINI_API_KEY in .env",
		});

	try {
		const { textStream } = look({
			...current,
			followUp,
			settings,
			getModel,
			signal,
		});
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
		// shortcut: raw message for now; #5 maps errors to short plain text.
		if (!signal.aborted)
			sendToHud({
				type: "error",
				text: error instanceof Error ? error.message : String(error),
			});
	}
}

const logError = (error: unknown) => console.error("Look failed:", error);

app.whenReady().then(() => {
	setupHud({
		recordable: settings.recordable,
		panelPosition: settings.panelPosition,
		onClosed: () => {
			inFlight?.abort();
			session = null;
		},
		onRegion: (display, rect, question) =>
			onRegion(display, rect, question).catch(logError),
		onFollowUp: (text) => onFollowUp(text).catch(logError),
	});
	const hotkey = () => onHotkey().catch(logError);
	if (!globalShortcut.register("Control+Shift+Space", hotkey))
		console.error("Ctrl+Shift+Space is taken by another app");
	globalShortcut.register("Control+Alt+Escape", () => app.quit()); // kill switch
	console.log(
		`Omnitrix ready (${settings.lookModel}${apiKey ? "" : ", no API key"}): press Ctrl+Shift+Space`,
	);
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {});
