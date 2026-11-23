// The only bridge between the HUD page and the main process.
import { contextBridge, ipcRenderer } from "electron";

export type Area = { x: number; y: number; width: number; height: number };

/**
 * Main -> HUD messages. All boxes are in CSS px of the HUD's monitor.
 * "region": the dim screen with the command box. "answer": a fresh panel next to box
 * (the dragged region, or a zero-size box at the cursor), kept inside area (the work area, no taskbar).
 */
export type HudMessage =
	| { type: "region" }
	| {
			type: "answer";
			box: Area;
			area: Area;
			position: "cursor" | "fixed";
	  }
	| { type: "chunk"; text: string }
	| { type: "notice"; text: string }
	| { type: "error"; text: string }
	| { type: "done" };

const api = {
	onMessage: (handler: (message: HudMessage) => void) =>
		ipcRenderer.on("hud", (_event, message: HudMessage) => handler(message)),
	close: () => ipcRenderer.send("hud:close"),
	pointerOverPanel: (over: boolean) =>
		ipcRenderer.send("hud:pointer-over-panel", over),
	/** The user dragged rect (question may be empty). The dim layer must already be off screen. */
	region: (rect: Area, question: string) =>
		ipcRenderer.send("hud:region", rect, question),
	followUp: (text: string) => ipcRenderer.send("hud:follow-up", text),
};
export type OmniApi = typeof api;

contextBridge.exposeInMainWorld("omni", api);
