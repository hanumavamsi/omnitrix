// Spike 2: one transparent, click-through, always-on-top, content-protected overlay per monitor.
// Run: npx electron spikes/02-overlay/main.js
// Ctrl+Shift+Space = show overlay on the monitor under the cursor. Esc = hide. Ctrl+Alt+Esc = quit.
import { BrowserWindow, app, globalShortcut, screen } from "electron";

const overlays = new Map(); // display.id -> BrowserWindow

function createOverlay(display) {
	const { x, y, width, height } = display.bounds;
	// D13: create directly on its own display and never move it (moving across mixed DPI rescales badly).
	const win = new BrowserWindow({
		x,
		y,
		width,
		height,
		show: false,
		frame: false,
		transparent: true,
		resizable: false,
		movable: false,
		skipTaskbar: true,
		focusable: false,
		hasShadow: false,
		webPreferences: { sandbox: true },
	});
	// Windows clamps new windows to the work area (screen minus taskbar); re-apply full bounds.
	win.setBounds(display.bounds);
	win.setIgnoreMouseEvents(true); // click-through
	win.setAlwaysOnTop(true, "screen-saver"); // above normal + fullscreen windows
	win.setContentProtection(true); // excluded from screenshots / screen share
	const info = {
		id: display.id,
		scale: display.scaleFactor,
		want: display.bounds,
		got: win.getBounds(),
	};
	win.loadFile(new URL("overlay.html", import.meta.url).pathname.slice(1), {
		query: { info: JSON.stringify(info) },
	});
	console.log("overlay", JSON.stringify(info));
	overlays.set(display.id, win);
}

function hideAll() {
	for (const w of overlays.values()) w.hide();
	globalShortcut.unregister("Escape");
}

function showUnderCursor() {
	const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	hideAll();
	overlays.get(target.id)?.showInactive(); // don't steal focus from the app the user is in
	// Overlay can't take focus, so Esc is a global shortcut only while visible.
	globalShortcut.register("Escape", hideAll);
}

app.whenReady().then(() => {
	for (const d of screen.getAllDisplays()) createOverlay(d);
	// shortcut: displays added/removed after start are ignored; real app must rebuild overlays.
	if (!globalShortcut.register("Control+Shift+Space", showUnderCursor))
		console.error("Ctrl+Shift+Space is taken by another app");
	globalShortcut.register("Control+Alt+Escape", () => app.quit());
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => globalShortcut.unregisterAll());
