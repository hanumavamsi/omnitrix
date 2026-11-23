// Omnitrix main process: Ctrl+Shift+Space explains the selected text, or a dragged screen region, in the HUD.
import { look } from "@omnitrix/agent";
import { app, type Display, globalShortcut, nativeImage } from "electron";
import type { Area } from "../preload/index.ts";
import { captureRegion } from "./capture.ts";
import { openConsole, setupConsole } from "./console.ts";
import { createConversation, NO_KEY } from "./conversation.ts";
import { prune, recordLook } from "./history.ts";
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

const conversation = createConversation({
	look,
	getApiKey: () => getApiKey("google"),
	getSettings,
	record: (session, info) => recordLook(dataDir, getSettings(), session, info),
	now: Date.now,
	emit: sendToHud,
});

async function onHotkey() {
	const overtaken = conversation.close(); // a new press always starts fresh and cancels the old Look
	if (isHudFocused()) return closeHud(); // pressed again while reading: just close

	rememberFocus();
	const text = await grabSelection();
	if (overtaken.aborted) return; // an even newer press took over during the grab

	// No key: say so before the user drags a region that can't be answered.
	if (!text && getApiKey("google")) return openHud("region");
	openHud("answer");
	if (!text) return sendToHud(NO_KEY);
	await conversation.start({ kind: "text", text });
}

async function onRegion(display: Display, rect: Area, question: string) {
	const overtaken = conversation.close();
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
	if (overtaken.aborted) return;
	showAnswer(rect);
	// History keeps only this small preview, never the full capture (L8).
	const thumb = nativeImage.createFromBuffer(png).resize({ width: 160 });
	await conversation.start(
		{ kind: "region", png, question },
		`data:image/jpeg;base64,${thumb.toJPEG(70).toString("base64")}`,
	);
}

const logError = (error: unknown) => console.error("Look failed:", error);

app.setName("Omnitrix"); // dialog titles; the package name would show otherwise
app.whenReady().then(() => {
	setupHud({
		recordable: getSettings().recordable,
		onClosed: () => conversation.close(),
		onRegion: (display, rect, question) =>
			onRegion(display, rect, question).catch(logError),
		onFollowUp: (text) => conversation.ask(text).catch(logError),
		onRetry: () => conversation.retry().catch(logError),
		onOpenConsole: openConsole,
	});
	setupConsole();
	const hasKey = Boolean(getApiKey("google"));
	if (!hasKey) openConsole(); // first run (L12): ask for the key straight away
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
