import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

const src = (path: string) => resolve(import.meta.dirname, "src", path);

export default defineConfig({
	main: {
		// The agent package ships TypeScript source, so bundle it instead of require()-ing it.
		build: { externalizeDeps: { exclude: ["@omnitrix/agent"] } },
	},
	preload: {
		// Sandboxed preloads must be CommonJS. One preload per page, so each gets only its own API.
		build: {
			rolldownOptions: {
				input: {
					index: src("preload/index.ts"),
					console: src("preload/console.ts"),
				},
				output: { format: "cjs", entryFileNames: "[name].cjs" },
			},
		},
	},
	renderer: {
		build: {
			rolldownOptions: {
				input: {
					index: src("renderer/index.html"),
					console: src("renderer/console.html"),
				},
			},
		},
	},
});
