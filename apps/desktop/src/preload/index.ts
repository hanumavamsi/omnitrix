// The only bridge between the HUD page and the main process.
import { contextBridge, ipcRenderer } from "electron";

export type Area = { x: number; y: number; width: number; height: number };

/**
 * Main -> HUD messages. All boxes are in CSS px of the HUD's monitor.
 * "region": the dim screen with the command box, area as below. "answer": a fresh panel next to box
 * (the dragged region, or a zero-size box at the cursor), kept inside area (the work area, no taskbar).
 */
export type HudMessage =
	| { type: "region"; area: Area }
	| {
			type: "answer";
			box: Area;
			area: Area;
			position: "cursor" | "fixed";
	  }
	| { type: "chunk"; text: string }
	| { type: "notice"; text: string; openConsole?: boolean } // openConsole: add an "Open Console" button
	| { type: "redacted"; count: number }
	| { type: "error"; text: string; retry: boolean; openConsole?: boolean }
	| { type: "fallback" } // the fallback model is answering
	| { type: "done" };

/**
 * HUD -> main messages: channel -> its arguments, as the api below sends them.
 * Main trusts none of it: hud.ts checks the sender is a HUD window and the shapes, in one place.
 */
export type HudEvents = {
	"hud:close": [];
	"hud:open-console": [];
	"hud:retry": [];
	"hud:pointer-over-panel": [over: boolean];
	"hud:region": [rect: Area, question: string];
	"hud:follow-up": [text: string];
};

const api = {
	onMessage: (handler: (message: HudMessage) => void) =>
		ipcRenderer.on("hud", (_event, message: HudMessage) => handler(message)),
	close: () => ipcRenderer.send("hud:close"),
	openConsole: () => ipcRenderer.send("hud:open-console"),
	retry: () => ipcRenderer.send("hud:retry"),
	pointerOverPanel: (over: boolean) =>
		ipcRenderer.send("hud:pointer-over-panel", over),
	/** The user dragged rect (question may be empty). The dim layer must already be off screen. */
	region: (rect: Area, question: string) =>
		ipcRenderer.send("hud:region", rect, question),
	followUp: (text: string) => ipcRenderer.send("hud:follow-up", text),
};
export type OmniApi = typeof api;

contextBridge.exposeInMainWorld("omni", api);
