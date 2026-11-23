import { configDefaults, defineConfig } from "vitest/config";

// .claude/ holds agent worktrees (full repo copies); their tests aren't ours.
export default defineConfig({
	test: { exclude: [...configDefaults.exclude, ".claude/**"] },
});
