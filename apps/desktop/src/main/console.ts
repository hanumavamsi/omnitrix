// The Console (glossary): the app window opened from the tray, for settings now and history later.
import { join } from "node:path";
import {
	app,
	BrowserWindow,
	type IpcMainInvokeEvent,
	ipcMain,
	Menu,
	nativeImage,
	shell,
	Tray,
} from "electron";
import type { ConsoleState } from "../preload/console.ts";
import { closeHud, setRecordable } from "./hud.ts";
import { clearApiKey, providers, providerViews, setApiKey } from "./keys.ts";
import { getSettings, saveSettings } from "./settings.ts";

let win: BrowserWindow | null = null;
let tray: Tray | null = null; // module-level so it is not garbage collected (the icon would vanish)

export function openConsole() {
	if (win) {
		if (win.isMinimized()) win.restore();
		win.focus();
		return;
	}
	win = new BrowserWindow({
		width: 760,
		height: 640,
		minWidth: 520,
		minHeight: 420,
		title: "Omnitrix Console",
		backgroundColor: "#050806",
		autoHideMenuBar: true,
		webPreferences: {
			sandbox: true,
			preload: join(import.meta.dirname, "../preload/console.cjs"),
		},
	});
	// The page has no business opening or navigating to other pages; links go through main.
	win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	win.webContents.on("will-navigate", (event) => event.preventDefault());
	win.on("closed", () => {
		win = null; // closing just destroys the window; the app lives on in the tray
	});
	if (process.env.ELECTRON_RENDERER_URL)
		win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/console.html`);
	else win.loadFile(join(import.meta.dirname, "../renderer/console.html"));
}

const state = (): ConsoleState => ({
	settings: getSettings(),
	providers: providerViews(),
});

// Settings and keys may only be touched by the Console page, not by the HUD or anything else.
function fromConsole(event: IpcMainInvokeEvent) {
	if (!win || event.sender !== win.webContents)
		throw new Error("Not allowed from this window");
}

export function setupConsole() {
	tray = new Tray(
		nativeImage.createFromPath(
			join(import.meta.dirname, "../../resources/tray.png"),
		),
	);
	tray.setToolTip("Omnitrix");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open Console", click: openConsole },
			{ type: "separator" },
			{ label: "Quit", click: () => app.quit() },
		]),
	);
	tray.on("click", openConsole);

	ipcMain.handle("console:get-state", (event) => {
		fromConsole(event);
		return state();
	});
	ipcMain.handle("console:save-settings", (event, raw: unknown) => {
		fromConsole(event);
		const settings = saveSettings(raw);
		setRecordable(settings.recordable); // the rest is read at use time
		return settings;
	});
	ipcMain.handle(
		"console:set-key",
		(event, provider: unknown, key: unknown) => {
			fromConsole(event);
			setApiKey(provider, key);
			return state();
		},
	);
	ipcMain.handle("console:clear-key", (event, provider: unknown) => {
		fromConsole(event);
		clearApiKey(provider);
		return state();
	});
	ipcMain.on("console:open-key-page", (event, provider: unknown) => {
		// The URL is ours, never the page's.
		const url = providers.find((p) => p.id === provider)?.keyUrl;
		if (url && win && event.sender === win.webContents) shell.openExternal(url);
	});
	ipcMain.on("hud:open-console", () => {
		closeHud({ returnFocus: false });
		openConsole();
	});
}
