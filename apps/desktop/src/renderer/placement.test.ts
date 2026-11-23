import { describe, expect, it } from "vitest";
import { placePanel, placeQuestion } from "./placement.ts";

// 1920x1080 display, 40px taskbar at the bottom, 400px panel.
const area = { x: 0, y: 0, width: 1920, height: 1040 };
const panel = { width: 400 };
const at = (x: number, y: number) => ({ x, y, width: 0, height: 0 });
const cursor = (box: ReturnType<typeof at>, a = area) =>
	placePanel({ box, area: a, panel, position: "cursor" });

describe("placePanel", () => {
	it("puts the panel above a mid-screen cursor when there is more room above", () => {
		expect(cursor(at(960, 540))).toEqual({
			left: 960,
			bottom: 526,
			maxHeight: 518,
		});
	});

	it("clamps a cursor on the taskbar into the work area", () => {
		const placed = cursor(at(500, 1060));
		expect(placed).toEqual({ left: 500, bottom: 1026, maxHeight: 1018 });
		// never over the taskbar
		if ("bottom" in placed) expect(placed.bottom).toBeLessThan(1040);
	});

	it("goes above a low box, capped to the room there", () => {
		expect(cursor({ x: 100, y: 800, width: 300, height: 200 })).toEqual({
			left: 100,
			bottom: 786,
			maxHeight: 778,
		});
	});

	it("goes below a high box and keeps clear of the right edge", () => {
		expect(cursor({ x: 1700, y: 50, width: 200, height: 100 })).toEqual({
			left: 1512,
			top: 164,
			maxHeight: 868,
		});
	});

	it("goes inside a box that nearly fills the screen", () => {
		expect(cursor({ x: 20, y: 20, width: 1880, height: 1000 })).toEqual({
			left: 28,
			top: 28,
			maxHeight: 984,
		});
	});

	it("fixed sits at the right edge of the work area", () => {
		const box = at(10, 10);
		expect(placePanel({ box, area, panel, position: "fixed" })).toEqual({
			left: 1512,
			top: 8,
			maxHeight: 1024,
		});
		const topBar = { x: 0, y: 40, width: 1920, height: 1040 };
		expect(placePanel({ box, area: topBar, panel, position: "fixed" })).toEqual(
			{ left: 1512, top: 48, maxHeight: 1024 },
		);
	});

	it("respects a work area offset by a taskbar on top", () => {
		const topBar = { x: 0, y: 40, width: 1920, height: 1040 };
		expect(cursor(at(960, 20), topBar)).toEqual({
			left: 960,
			top: 54,
			maxHeight: 1018,
		});
	});

	it("respects a work area offset by a taskbar on the left", () => {
		const leftBar = { x: 60, y: 0, width: 1860, height: 1080 };
		expect(cursor(at(10, 500), leftBar)).toEqual({
			left: 68,
			top: 514,
			maxHeight: 558,
		});
	});
});

describe("placeQuestion", () => {
	it("sits under the box", () => {
		expect(
			placeQuestion({ x: 100, y: 100, width: 50, height: 50 }, area),
		).toEqual({ left: 100, top: 156 });
	});
	it("goes above a box near the taskbar", () => {
		expect(
			placeQuestion({ x: 100, y: 900, width: 100, height: 120 }, area),
		).toEqual({ left: 100, top: 854 });
	});
	it("goes inside a nearly full-height box, still in the work area", () => {
		expect(
			placeQuestion({ x: 100, y: 10, width: 500, height: 1070 }, area),
		).toEqual({ left: 100, top: 1000 });
	});
	it("clamps left at the right edge", () => {
		expect(
			placeQuestion({ x: 1800, y: 100, width: 100, height: 50 }, area),
		).toEqual({ left: 1590, top: 156 });
	});
	it("respects a work area offset by a top or left taskbar", () => {
		const offset = { x: 60, y: 40, width: 1860, height: 1040 };
		expect(
			placeQuestion({ x: 0, y: 40, width: 100, height: 1040 }, offset),
		).toEqual({ left: 60, top: 1034 });
	});
});
