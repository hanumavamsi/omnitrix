// Spike 3: grab the current selection in any app via simulated Ctrl+C, then restore the clipboard.
// Run: npx electron spikes/03-selection/main.js
// Select text anywhere, press Ctrl+Shift+Space. Ctrl+Alt+Esc quits.
import { ClipboardItem, app, clipboard, globalShortcut } from "electron";
import koffi from "koffi";

const user32 = koffi.load("user32.dll");
const keybd_event = user32.func(
	"void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)",
);
const GetAsyncKeyState = user32.func("int16 __stdcall GetAsyncKeyState(int vk)");
const GetClipboardSequenceNumber = user32.func("uint32 __stdcall GetClipboardSequenceNumber()");
const GetForegroundWindow = user32.func("void * __stdcall GetForegroundWindow()");
const GetWindowTextW = user32.func("int __stdcall GetWindowTextW(void *hwnd, _Out_ uint16_t *buf, int max)");

const VK = { SHIFT: 0x10, CONTROL: 0x11, ALT: 0x12, SPACE: 0x20, C: 0x43 };
const KEYUP = 0x0002;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDown = (vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0;

function foregroundTitle() {
	const buf = new Uint16Array(256);
	const n = GetWindowTextW(GetForegroundWindow(), buf, buf.length);
	return String.fromCharCode(...buf.subarray(0, n));
}

// Electron 45 clipboard is async + W3C-style: read() -> ClipboardItem[], write(ClipboardItem[]).
// Payloads are read eagerly: after our Ctrl+C the originals are gone.
// shortcut: only types Electron exposes survive (files / app-private formats may not); test more apps in P1.
async function snapshot() {
	const items = [];
	const types = [];
	for (const item of await clipboard.read()) {
		const entries = [];
		for (const t of item.types) {
			try {
				entries.push([t, await item.getType(t)]);
				types.push(t);
			} catch {} // type advertised but unreadable: skip it
		}
		if (entries.length) items.push(new ClipboardItem(Object.fromEntries(entries)));
	}
	return { items, types, text: await clipboard.readText() };
}
async function restore(s) {
	if (s.items.length) await clipboard.write(s.items);
	else await clipboard.clear();
}

async function grabSelection() {
	const t0 = performance.now();
	const title = foregroundTitle();
	// The hotkey's Ctrl+Shift are still physically held; Ctrl+C now would become Ctrl+Shift+C
	// (Chrome DevTools inspect!). Wait for the user to let go, max 1s.
	const held = [VK.SHIFT, VK.CONTROL, VK.ALT, VK.SPACE];
	// Deadlines, not loop counts: Windows timers tick ~15.6ms, so 100 x sleep(10) overshoots.
	const releaseBy = performance.now() + 1000;
	while (held.some(isDown) && performance.now() < releaseBy) await sleep(5);
	const tReleased = performance.now();

	const saved = await snapshot();
	const seq0 = GetClipboardSequenceNumber();
	keybd_event(VK.CONTROL, 0, 0, 0);
	keybd_event(VK.C, 0, 0, 0);
	keybd_event(VK.C, 0, KEYUP, 0);
	keybd_event(VK.CONTROL, 0, KEYUP, 0);

	// Clipboard sequence number bumps when the app copies. No bump in 500ms = nothing selected.
	let changed = false;
	const copyBy = performance.now() + 500;
	while (!changed && performance.now() < copyBy) {
		await sleep(5);
		changed = GetClipboardSequenceNumber() !== seq0;
	}
	await sleep(20); // some apps write several formats one after another
	const text = changed ? await clipboard.readText() : "";
	const tCopied = performance.now();
	if (changed) await restore(saved);
	const restoredOk = (await clipboard.readText()) === saved.text;

	console.log(
		JSON.stringify({
			app: title,
			selection: changed ? `${text.length} chars: ${JSON.stringify(text.slice(0, 80))}` : "NONE",
			waitRelease_ms: Math.round(tReleased - t0),
			copy_ms: Math.round(tCopied - tReleased),
			restoredOk,
			savedTypes: saved.types,
		}),
	);
}

app.whenReady().then(() => {
	if (!globalShortcut.register("Control+Shift+Space", () =>
			grabSelection().catch((e) => console.error("grab failed:", e)),
		))
		console.error("Ctrl+Shift+Space is taken by another app");
	globalShortcut.register("Control+Alt+Escape", () => app.quit());
	console.log("ready: select text anywhere, press Ctrl+Shift+Space");
});
app.on("will-quit", () => globalShortcut.unregisterAll());
// Keep running with no windows.
app.on("window-all-closed", () => {});
