// Omnitrix main process: Ctrl+Shift+Space explains the selected text, or a dragged screen region, in the HUD.
import {
	createModelResolver,
	LookError,
	type LookErrorKind,
	look,
} from "@omnitrix/agent";
import {
	app,
	type Display,
	globalShortcut,
	ipcMain,
	nativeImage,
} from "electron";
import type { Area } from "../preload/index.ts";
import { captureRegion } from "./capture.ts";
import { openConsole, setupConsole } from "./console.ts";
import {
	type AnswerInfo,
	type LookSession,
	prune,
	recordLook,
} from "./history.ts";
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
import { dataDir, getSettings } from "./settings.ts";

let inFlight: AbortController | null = null;
// The open conversation: kept for follow-ups until the panel closes or the hotkey is pressed again.
let session: LookSession | null = null;
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
	session = newSession({ kind: "text", text });
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
	session = newSession({ kind: "region", png, question });
	// History keeps only this small preview, never the full capture (L8).
	const thumb = nativeImage.createFromBuffer(png).resize({ width: 160 });
	session.thumbnail = `data:image/jpeg;base64,${thumb.toJPEG(70).toString("base64")}`;
	await answer(signal);
}

const newSession = (capture: LookSession["capture"]): LookSession => ({
	id: Date.now(),
	capture,
	conversation: [],
	model: getSettings().lookModel,
	fallback: false,
});

async function onFollowUp(text: string) {
	if (!session) return;
	await answer(newRequest(), text);
}

/** Streams one answer of the open session into the HUD and records the turn once it completes. */
async function answer(signal: AbortSignal, followUp?: string, retry = false) {
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

	const settings = getSettings();
	const info: AnswerInfo = {
		startedAt: Date.now(),
		endedAt: 0,
		model: settings.lookModel,
		fallback: false,
		retry,
		followUp,
	};
	// Every outcome gets a trace; history only gets finished answers (recordLook checks).
	const finish = (error?: LookErrorKind) => {
		info.endedAt = Date.now();
		info.error = error;
		try {
			recordLook(dataDir, getSettings(), current, info);
		} catch (e) {
			console.error("Saving history/trace failed:", e);
		}
	};

	try {
		const { textStream, redactedCount } = look({
			...current,
			followUp,
			settings,
			getModel: createModelResolver(apiKey),
			signal,
			onFallback: () => {
				info.model = settings.lookFallbackModel;
				info.fallback = true;
				sendToHud({ type: "fallback" });
			},
			onUsage: (usage) => {
				info.usage = usage;
			},
		});
		if (redactedCount > 0)
			sendToHud({ type: "redacted", count: redactedCount });
		let full = "";
		for await (const chunk of textStream) {
			if (signal.aborted) return finish("aborted"); // drop late chunks
			full += chunk;
			sendToHud({ type: "chunk", text: chunk });
		}
		if (signal.aborted) return finish("aborted");
		if (followUp)
			current.conversation.push({ role: "user", content: followUp });
		current.conversation.push({ role: "assistant", content: full });
		current.model = info.model;
		current.fallback ||= info.fallback;
		info.answer = full;
		finish();
		sendToHud({ type: "done" });
	} catch (error) {
		const kind = error instanceof LookError ? error.kind : "other";
		if (signal.aborted) return finish("aborted");
		finish(kind);
		console.error("Look failed:", error); // the full error stays in the terminal for debugging
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
		answer(newRequest(), lastFollowUp, true).catch(logError),
	);
	prune(dataDir, Date.now()); // the app lives in the tray for days, so recordLook prunes too
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
