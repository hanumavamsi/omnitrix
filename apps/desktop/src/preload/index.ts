// The only bridge between the HUD page and the main process.
import { contextBridge, ipcRenderer } from "electron";

/** Main -> HUD messages. x/y are the cursor in CSS px of the HUD's monitor. */
export type HudMessage =
	| { type: "open"; x: number; y: number }
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
};
export type OmniApi = typeof api;

contextBridge.exposeInMainWorld("omni", api);
