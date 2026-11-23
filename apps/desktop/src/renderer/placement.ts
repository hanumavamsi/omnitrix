// Where the answer panel and the box question go. Pure: all boxes are CSS px of the HUD's monitor.
import type { Area } from "../preload/index.ts";

const MARGIN = 8; // keep clear of the screen edge
const GAP = 14; // keep clear of the cursor or the box
const MIN_ROOM = 160; // with less room than this beside the box, the panel goes inside it
const QUESTION_WIDTH = 330; // the box question input, roughly
const QUESTION_HEIGHT = 40;
const QUESTION_GAP = 6;

/** Panel position. `bottom` is the y of the panel's bottom edge: placed above the box, it grows upward. */
export type PanelPlacement = { left: number; maxHeight: number } & (
	| { top: number }
	| { bottom: number }
);

/**
 * Beside the box (a zero-size box for the cursor) on the side with more room, capped to that room
 * so it never leaves the work area; inside the box when the box nearly fills the screen.
 * "fixed" is the right edge of the work area.
 */
export function placePanel({
	box,
	area,
	panel,
	position,
}: {
	box: Area;
	area: Area;
	panel: { width: number };
	position: "cursor" | "fixed";
}): PanelPlacement {
	const right = area.x + area.width - panel.width - MARGIN;
	const bottom = area.y + area.height;
	if (position === "fixed")
		return {
			left: right,
			top: area.y + MARGIN,
			maxHeight: area.height - 2 * MARGIN,
		};

	const clampLeft = (x: number) =>
		Math.max(area.x + MARGIN, Math.min(x, right));
	// The cursor or box can reach onto the taskbar, outside the work area.
	const clampY = (y: number) => Math.min(Math.max(y, area.y), bottom);
	const boxTop = clampY(box.y);
	const boxBottom = clampY(box.y + box.height);
	const roomBelow = bottom - boxBottom - GAP - MARGIN;
	const roomAbove = boxTop - area.y - GAP - MARGIN;
	if (Math.max(roomBelow, roomAbove) < MIN_ROOM) {
		const top = boxTop + MARGIN;
		return {
			left: clampLeft(box.x + MARGIN),
			top,
			maxHeight: boxBottom - top - MARGIN,
		};
	}
	if (roomBelow >= roomAbove)
		return {
			left: clampLeft(box.x),
			top: boxBottom + GAP,
			maxHeight: roomBelow,
		};
	return {
		left: clampLeft(box.x),
		bottom: boxTop - GAP,
		maxHeight: roomAbove,
	};
}

/** The question input under the dragged box, kept on the monitor (viewport = the HUD window). */
export function placeQuestion(
	box: Area,
	viewport: { width: number; height: number },
) {
	return {
		left: Math.max(0, Math.min(box.x, viewport.width - QUESTION_WIDTH)),
		top: Math.min(
			box.y + box.height + QUESTION_GAP,
			viewport.height - QUESTION_HEIGHT,
		),
	};
}
