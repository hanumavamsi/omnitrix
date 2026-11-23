// The only bridge between the Console page and the main process. Main validates everything sent here.
import type { Settings } from "@omnitrix/agent";
import { contextBridge, ipcRenderer } from "electron";

/** "env": an env var overrides the stored key (dev). The key itself never comes back to the page. */
export type KeyState = "none" | "saved" | "env";
export type ProviderView = {
	id: string;
	name: string;
	envVar: string;
	warning: string;
	key: KeyState;
};
export type ConsoleState = { settings: Settings; providers: ProviderView[] };

const api = {
	getState: (): Promise<ConsoleState> =>
		ipcRenderer.invoke("console:get-state"),
	saveSettings: (settings: Settings): Promise<Settings> =>
		ipcRenderer.invoke("console:save-settings", settings),
	setKey: (provider: string, key: string): Promise<ConsoleState> =>
		ipcRenderer.invoke("console:set-key", provider, key),
	clearKey: (provider: string): Promise<ConsoleState> =>
		ipcRenderer.invoke("console:clear-key", provider),
	openKeyPage: (provider: string) =>
		ipcRenderer.send("console:open-key-page", provider),
};
export type ConsoleApi = typeof api;

contextBridge.exposeInMainWorld("omniConsole", api);
