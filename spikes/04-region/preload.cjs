// Sandboxed preloads must be CommonJS. Exposes only the two calls the overlay needs.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("omni", {
	region: (rect, question) => ipcRenderer.invoke("region", rect, question),
	cancel: () => ipcRenderer.send("cancel"),
	onReset: (fn) => ipcRenderer.on("reset", fn),
});
