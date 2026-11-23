// The only bridge between the HUD page and the main process.
import { contextBridge, ipcRenderer } from "electron";

export type Area = { x: number; y: number; width: number; height: number };

/** Main -> HUD messages. x/y are the cursor and area the work area (no taskbar), in CSS px of the HUD's monitor. */
export type HudMessage =
	| { type: "open"; x: number; y: number; area: Area }
	| { type: "chunk"; text: string }
	| { type: "notice"; text: string }
	| { type: "redacted"; count: number }
	| { type: "error"; text: string }
	| { type: "done" };

const api = {
	onMessage: (handler: (message: HudMessage) => void) =>
		ipcRenderer.on("hud", (_event, message: HudMessage) => handler(message)),
	close: () => ipcRenderer.send("hud:close"),
	pointerOverPanel: (over: boolean) =>
		ipcRenderer.send("hud:pointer-over-panel", over),
};
export type OmniApi = typeof api;

contextBridge.exposeInMainWorld("omni", api);
