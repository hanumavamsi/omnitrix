// The HUD: one see-through window per monitor (spike 2), shown on the monitor under the cursor.
import { join } from "node:path";
import {
	BrowserWindow,
	type Display,
	globalShortcut,
	ipcMain,
	screen,
} from "electron";
import type { HudMessage } from "../preload/index.ts";
import {
	GetForegroundWindow,
	GetWindowThreadProcessId,
	IsWindow,
	SetForegroundWindow,
} from "./win32.ts";

const huds = new Map<number, BrowserWindow>(); // display.id -> its HUD window
let shown: BrowserWindow | null = null;
let returnFocusTo: unknown = null; // HWND of the app the user came from
let recordable = false;
let onClosed = () => {};

function createHud(display: Display) {
	// D13: created on its own display and never moved; moving across mixed DPI rescales badly.
	const win = new BrowserWindow({
		...display.bounds,
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
	win.setBounds(display.bounds); // Windows clamps new windows to the work area
	win.setIgnoreMouseEvents(true, { forward: true }); // click-through; the panel turns it off on hover
	win.setAlwaysOnTop(true, "screen-saver");
	win.setContentProtection(!recordable); // hidden from screenshots unless Recordable is on
	// Esc is ours only while the HUD has focus; the user's apps need it back once they click away (L14).
	win.on(
		"focus",
		() => win === shown && globalShortcut.register("Escape", closeHud),
	);
	win.on("blur", () => globalShortcut.unregister("Escape"));
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

export function setupHud(options: {
	recordable: boolean;
	onClosed: () => void;
}) {
	recordable = options.recordable;
	onClosed = options.onClosed;
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
}

/** Recordable on: screen capture (OBS, Game Bar, test screenshots) sees the HUD (D13). */
export function setRecordable(on: boolean) {
	recordable = on;
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
	globalShortcut.unregister("Escape");
}

/** Shows an empty panel near the cursor on the monitor the cursor is on. */
export function openHud() {
	const cursor = screen.getCursorScreenPoint();
	const display = screen.getDisplayNearestPoint(cursor);
	hideHuds();
	shown = huds.get(display.id) ?? null;
	if (!shown) return;
	// The renderer works in CSS px, which equal DIP relative to its own display.
	sendToHud({
		type: "open",
		x: cursor.x - display.bounds.x,
		y: cursor.y - display.bounds.y,
		area: {
			x: display.workArea.x - display.bounds.x,
			y: display.workArea.y - display.bounds.y,
			width: display.workArea.width,
			height: display.workArea.height,
		},
	});
	shown.setIgnoreMouseEvents(true, { forward: true }); // the pointer may have left over the old panel
	shown.show();
	shown.focus();
	globalShortcut.register("Escape", closeHud);
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
	onClosed();
	if (target) SetForegroundWindow(target);
	returnFocusTo = null;
}
