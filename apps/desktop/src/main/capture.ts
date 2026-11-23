// Region capture (spike 4): grab the display with desktopCapturer and crop the dragged box.
import { type Display, desktopCapturer } from "electron";
import type { Area } from "../preload/index.ts";

/** rect is in CSS px of the HUD = DIP relative to the display's top-left. Returns PNG bytes. */
export async function captureRegion(display: Display, rect: Area) {
	const s = display.scaleFactor;
	// shortcut: desktopCapturer grabs every screen at this size and we keep one; fine for 2 monitors.
	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: {
			width: display.size.width * s,
			height: display.size.height * s,
		},
	});
	const source = sources.find((x) => x.display_id === String(display.id));
	if (!source) throw new Error(`No capture source for display ${display.id}`);
	const full = source.thumbnail;
	// The thumbnail is scaled to fit thumbnailSize; derive the real ratio instead of trusting scaleFactor.
	const k = full.getSize().width / display.size.width;
	return full
		.crop({
			x: Math.round(rect.x * k),
			y: Math.round(rect.y * k),
			width: Math.max(1, Math.round(rect.width * k)),
			height: Math.max(1, Math.round(rect.height * k)),
		})
		.toPNG();
}
