// The HUD: one see-through window per monitor (spike 2), shown on the monitor under the cursor.
import { join } from "node:path";
import {
	BrowserWindow,
	type Display,
	globalShortcut,
	ipcMain,
	screen,
} from "electron";
import type { Area, HudMessage } from "../preload/index.ts";
import { getSettings } from "./settings.ts";
import {
	GetForegroundWindow,
	GetWindowThreadProcessId,
	IsWindow,
	SetForegroundWindow,
} from "./win32.ts";

const huds = new Map<number, BrowserWindow>(); // display.id -> its HUD window
let shown: BrowserWindow | null = null;
let shownDisplay: Display | null = null;
let returnFocusTo: unknown = null; // HWND of the app the user came from
let options: HudOptions;

type HudOptions = {
	recordable: boolean;
	onClosed: () => void;
	onRegion: (display: Display, rect: Area, question: string) => void;
	onFollowUp: (text: string) => void;
};

function createHud(display: Display) {
	// D13: created on its own display and never moved; moving across mixed DPI rescales badly.
	// 1px short of the monitor: a topmost window covering it exactly counts as fullscreen and hides the taskbar.
	const bounds = { ...display.bounds, height: display.bounds.height - 1 };
	const win = new BrowserWindow({
		...bounds,
		show: false,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		movable: false,
		skipTaskbar: true,
		hasShadow: false,
		webPreferences: {
			sandbox: true,
			preload: join(import.meta.dirname, "../preload/index.cjs"),
		},
	});
	win.setBounds(bounds); // Windows clamps new windows to the work area
	win.setIgnoreMouseEvents(true, { forward: true }); // click-through; the panel turns it off on hover
	win.setAlwaysOnTop(true, "screen-saver");
	win.setContentProtection(!options.recordable); // hidden from screenshots unless Recordable is on
	// Esc is ours only while the HUD has focus; the user's apps need it back once they click away (L14).
	win.on(
		"focus",
		() => win === shown && globalShortcut.register("Escape", closeHud),
	);
	win.on("blur", () => globalShortcut.unregister("Escape"));
	// Answers are model output: a link in them must never navigate or open our window.
	win.webContents.on("will-navigate", (event) => event.preventDefault());
	win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	if (process.env.ELECTRON_RENDERER_URL)
		win.loadURL(process.env.ELECTRON_RENDERER_URL);
	else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
	huds.set(display.id, win);
}

function rebuildHuds() {
	if (shown) closeHud();
	for (const win of huds.values()) win.destroy();
	huds.clear();
	for (const display of screen.getAllDisplays()) createHud(display);
}

export function setupHud(hudOptions: HudOptions) {
	options = hudOptions;
	rebuildHuds();
	screen.on("display-added", rebuildHuds);
	screen.on("display-removed", rebuildHuds);
	screen.on("display-metrics-changed", rebuildHuds);
	ipcMain.on("hud:close", () => closeHud());
	ipcMain.on("hud:pointer-over-panel", (event, over: boolean) => {
		BrowserWindow.fromWebContents(event.sender)?.setIgnoreMouseEvents(!over, {
			forward: true,
		});
	});
	ipcMain.on("hud:region", (event, rect: Area, question: string) => {
		if (!shownDisplay || event.sender !== shown?.webContents) return;
		options.onRegion(shownDisplay, rect, question);
	});
	ipcMain.on("hud:follow-up", (_event, text: string) =>
		options.onFollowUp(text),
	);
}

/** Recordable on: screen capture (OBS, Game Bar, test screenshots) sees the HUD (D13). */
export function setRecordable(on: boolean) {
	options.recordable = on;
	for (const win of huds.values()) win.setContentProtection(!on);
}

/** Call before grabbing the selection, while the user's app is still in front. */
export function rememberFocus() {
	const hwnd = GetForegroundWindow();
	const pid = [0];
	if (hwnd) GetWindowThreadProcessId(hwnd, pid);
	if (pid[0] !== process.pid) returnFocusTo = hwnd; // never "return" to our own hidden HUD
}

export function isHudFocused() {
	return shown?.isFocused() ?? false;
}

function hideHuds() {
	for (const win of huds.values()) win.hide();
	shown = null;
	shownDisplay = null;
	globalShortcut.unregister("Escape");
}

/** Shows the HUD on the monitor under the cursor: an empty answer panel there, or the dim region screen. */
export function openHud(mode: "answer" | "region") {
	const cursor = screen.getCursorScreenPoint();
	const display = screen.getDisplayNearestPoint(cursor);
	hideHuds();
	shown = huds.get(display.id) ?? null;
	if (!shown) return;
	shownDisplay = display;
	if (mode === "region") {
		sendToHud({ type: "region" });
		shown.setIgnoreMouseEvents(false); // the whole screen takes the drag
	} else {
		// The renderer works in CSS px, which equal DIP relative to its own display.
		const { x, y } = display.bounds;
		showAnswer({ x: cursor.x - x, y: cursor.y - y, width: 0, height: 0 });
	}
	shown.show();
	shown.focus();
	globalShortcut.register("Escape", closeHud);
}

/** Starts a fresh answer panel next to box, on the monitor the HUD is already showing. */
export function showAnswer(box: Area) {
	if (!shown || !shownDisplay) return;
	const { bounds, workArea } = shownDisplay;
	sendToHud({
		type: "answer",
		box,
		area: { ...workArea, x: workArea.x - bounds.x, y: workArea.y - bounds.y },
		position: getSettings().panelPosition, // read now: the Console can change it
	});
	shown.setIgnoreMouseEvents(true, { forward: true }); // click-through again; the pointer may not be over the panel
}

export function sendToHud(message: HudMessage) {
	if (shown && !shown.isDestroyed()) shown.webContents.send("hud", message);
}

/** returnFocus false: another Omnitrix window (the Console) takes focus instead of the user's app. */
export function closeHud({ returnFocus = true } = {}) {
	if (!returnFocus) returnFocusTo = null;
	// Hiding a focused window doesn't hand focus back on Windows. IsWindow: that app may have closed meanwhile.
	const target =
		returnFocusTo && IsWindow(returnFocusTo) ? returnFocusTo : null;
	if (!target) shown?.blur(); // no app to return to: at least don't leave focus on our hidden HUD
	hideHuds();
	options.onClosed();
	if (target) SetForegroundWindow(target);
	returnFocusTo = null;
}
