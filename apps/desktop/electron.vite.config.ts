import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		// The agent package ships TypeScript source, so bundle it instead of require()-ing it.
		build: { externalizeDeps: { exclude: ["@omnitrix/agent"] } },
	},
	preload: {
		// Sandboxed preloads must be CommonJS.
		build: {
			rolldownOptions: {
				output: { format: "cjs", entryFileNames: "[name].cjs" },
			},
		},
	},
	renderer: {},
});
