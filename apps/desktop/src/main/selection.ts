// Grab the selection in whatever app is in front: simulated Ctrl+C, then put the clipboard back (spike 3).
import { type ClipboardBookmark, ClipboardItem, clipboard } from "electron";
import {
	GetAsyncKeyState,
	GetClipboardSequenceNumber,
	keybd_event,
} from "./win32.ts";

const VK = { SHIFT: 0x10, CONTROL: 0x11, ALT: 0x12, SPACE: 0x20, C: 0x43 };
const KEYUP = 0x0002;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isDown = (vk: number) => (GetAsyncKeyState(vk) & 0x8000) !== 0;

// Waits until check() is true or ms pass. Deadlines, not loop counts: Windows timers tick ~15.6ms.
async function waitUntil(check: () => boolean, ms: number) {
	const deadline = performance.now() + ms;
	while (!check() && performance.now() < deadline) await sleep(5);
}

// Electron 45 clipboard is async (W3C style). Payloads are read now: after our Ctrl+C they're gone.
// shortcut: only the formats Electron exposes survive; app-private formats may be lost. Widen if users report it.
async function snapshotClipboard() {
	const items: ClipboardItem[] = [];
	for (const item of await clipboard.read()) {
		const entries: [string, Blob | ClipboardBookmark][] = [];
		for (const type of item.types) {
			try {
				entries.push([type, await item.getType(type)]);
			} catch {} // advertised but unreadable: skip it
		}
		if (entries.length)
			items.push(new ClipboardItem(Object.fromEntries(entries)));
	}
	return items;
}

/** Returns the selected text, or "" when nothing is selected. */
export async function grabSelection(): Promise<string> {
	// The hotkey's Ctrl+Shift are still held. Ctrl+C now would arrive as Ctrl+Shift+C (DevTools in Chrome).
	await waitUntil(
		() => ![VK.SHIFT, VK.CONTROL, VK.ALT, VK.SPACE].some(isDown),
		1000,
	);

	const saved = await snapshotClipboard();
	const before = GetClipboardSequenceNumber();
	keybd_event(VK.CONTROL, 0, 0, 0);
	keybd_event(VK.C, 0, 0, 0);
	keybd_event(VK.C, 0, KEYUP, 0);
	keybd_event(VK.CONTROL, 0, KEYUP, 0);

	// The sequence number bumps when the app copies; no bump in 500ms means nothing was selected.
	await waitUntil(() => GetClipboardSequenceNumber() !== before, 500);
	if (GetClipboardSequenceNumber() === before) return "";
	await sleep(20); // some apps write several formats one after another
	const text = await clipboard.readText();
	if (saved.length) await clipboard.write(saved);
	else await clipboard.clear();
	return text.trim();
}
