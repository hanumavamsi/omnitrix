// Spike 4: drag a screen region, capture it, ask Gemini vision about it.
// Run: npx electron spikes/04-region/main.js   (reads GEMINI_API_KEY + OMNITRIX_MODEL from .env)
// Ctrl+Shift+Space = dim the monitor under the cursor, drag a box, type an optional question, Enter.
// Esc = cancel. Ctrl+Alt+Esc = quit. Crops are saved to %TEMP%/omnitrix-spike4 for checking quality.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	globalShortcut,
	ipcMain,
	screen,
} from "electron";
import koffi from "koffi";

process.loadEnvFile(".env");
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey)
	throw new Error(
		"GEMINI_API_KEY missing: put it in .env (never in code or chat)",
	);
const model = (
	process.env.OMNITRIX_MODEL ?? "google:gemini-flash-latest"
).replace(/^google:/, "");
const outDir = join(tmpdir(), "omnitrix-spike4");
mkdirSync(outDir, { recursive: true });

const overlays = new Map(); // display.id -> BrowserWindow

function createOverlay(display) {
	// D13: one window per display, created on it and never moved.
	const win = new BrowserWindow({
		...display.bounds,
		show: false,
		frame: false,
		transparent: true,
		resizable: false,
		movable: false,
		skipTaskbar: true,
		hasShadow: false,
		// Focusable this time: region mode needs the mouse and the question box needs keys.
		webPreferences: {
			sandbox: true,
			preload: join(import.meta.dirname, "preload.cjs"),
		},
	});
	win.setBounds(display.bounds); // Windows clamps new windows to the work area
	win.setAlwaysOnTop(true, "screen-saver");
	win.setContentProtection(true); // keeps the dim layer out of our own capture
	win.loadFile(join(import.meta.dirname, "overlay.html"));
	overlays.set(display.id, win);
}

// Hiding a focused window doesn't hand focus back on Windows; remember who had it and restore.
const user32 = koffi.load("user32.dll");
const GetForegroundWindow = user32.func(
	"void * __stdcall GetForegroundWindow()",
);
const SetForegroundWindow = user32.func(
	"bool __stdcall SetForegroundWindow(void *hwnd)",
);
const IsWindow = user32.func("bool __stdcall IsWindow(void *hwnd)");
const GetWindowThreadProcessId = user32.func(
	"uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)",
);
let prevFocus = null;

function hideAll() {
	for (const w of overlays.values()) w.hide();
	// IsWindow: the app may have closed while the overlay was open.
	if (prevFocus && IsWindow(prevFocus)) SetForegroundWindow(prevFocus); // allowed: we are foreground now
	prevFocus = null;
}

function startRegion() {
	const fg = GetForegroundWindow();
	const pid = [0];
	if (fg) GetWindowThreadProcessId(fg, pid);
	// Never save one of our own (hidden) overlays as the window to return to.
	if (pid[0] !== process.pid) prevFocus = fg;
	const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	for (const w of overlays.values()) w.hide(); // not hideAll(): keep prevFocus when switching monitors
	const win = overlays.get(d.id);
	win.webContents.send("reset");
	win.show();
	win.focus();
}

// rect is in CSS px of the overlay = DIP relative to its display's top-left.
async function capture(display, rect) {
	const s = display.scaleFactor;
	const t0 = performance.now();
	// shortcut: desktopCapturer grabs every screen at this size and we keep one; fine for 2 monitors.
	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: {
			width: display.size.width * s,
			height: display.size.height * s,
		},
	});
	const src = sources.find((x) => x.display_id === String(display.id));
	if (!src) throw new Error(`no capture source for display ${display.id}`);
	const full = src.thumbnail;
	// Thumbnail is scaled to fit thumbnailSize; derive the real ratio instead of trusting scaleFactor.
	const k = full.getSize().width / display.size.width;
	const crop = full.crop({
		x: Math.round(rect.x * k),
		y: Math.round(rect.y * k),
		width: Math.max(1, Math.round(rect.width * k)),
		height: Math.max(1, Math.round(rect.height * k)),
	});
	const png = crop.toPNG();
	return {
		png,
		size: crop.getSize(),
		full: full.getSize(),
		capture_ms: Math.round(performance.now() - t0),
	};
}

async function askGemini(png, question) {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
	const body = JSON.stringify({
		contents: [
			{
				role: "user",
				parts: [
					{
						inline_data: {
							mime_type: "image/png",
							data: png.toString("base64"),
						},
					},
					{ text: question },
				],
			},
		],
	});
	let res;
	// 503 overloaded / 429 rate limit are temporary: retry 1s, 2s, 4s (same as spike 1).
	for (let attempt = 0; ; attempt++) {
		res = await fetch(url, {
			method: "POST",
			signal: AbortSignal.timeout(30_000),
			headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
			body,
		});
		if ((res.status !== 503 && res.status !== 429) || attempt === 3) break;
		console.warn(`Gemini ${res.status}, retry ${attempt + 1}/3`);
		await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
	}
	if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
	const data = await res.json();
	const text =
		data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
		"";
	return { text, usage: data.usageMetadata };
}

ipcMain.handle("region", async (e, rect, question) => {
	const win = BrowserWindow.fromWebContents(e.sender);
	const display = screen
		.getAllDisplays()
		.find((d) => overlays.get(d.id) === win);
	const t0 = performance.now();
	const shot = await capture(display, rect);
	const file = join(outDir, `crop-${Date.now()}.png`);
	writeFileSync(file, shot.png);
	const q =
		question.trim() || "Explain what is shown in this screenshot. Be concise.";
	const t1 = performance.now();
	const ans = await askGemini(shot.png, q);
	const log = {
		model,
		display: { id: display.id, scale: display.scaleFactor },
		rect_dip: rect,
		crop_px: shot.size,
		full_px: shot.full,
		png_kb: Math.round(shot.png.length / 1024),
		capture_ms: shot.capture_ms,
		gemini_ms: Math.round(performance.now() - t1),
		total_ms: Math.round(performance.now() - t0),
		tokens: ans.usage,
		file,
	};
	console.log(JSON.stringify(log));
	console.log(`Q: ${q}\nA: ${ans.text}\n`);
	return { answer: ans.text, log };
});
ipcMain.on("cancel", hideAll);

app.whenReady().then(() => {
	for (const d of screen.getAllDisplays()) createOverlay(d);
	if (!globalShortcut.register("Control+Shift+Space", startRegion))
		console.error("Ctrl+Shift+Space is taken by another app");
	globalShortcut.register("Control+Alt+Escape", () => app.quit());
	console.log(`ready (${model}): press Ctrl+Shift+Space and drag a box`);
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {});
