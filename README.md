# Omnitrix (codename)

A Windows desktop AI assistant with a transparent HUD overlay.

- **Look** — select text or drag a box on screen, press `Ctrl+Shift+Space`, get an explanation.
- **Act** — tell it to do things in the browser; a ghost cursor shows every step and risky steps ask first.

Works with any LLM (default: Gemini Flash). Its tools are also exposed as an MCP server, so Claude Code / Cursor / Gemini CLI can use them.

> **Status:** early development. See [docs/PLAN.md](docs/PLAN.md).

## Privacy

When you trigger Look, the selected text or screen region is sent to the model provider you configure. On Gemini's free tier, Google may use prompts to improve its products. Nothing is captured without an explicit hotkey press.

## Development

Requires Node 22+ and [gitleaks](https://github.com/gitleaks/gitleaks) (pre-commit secret scan).

```sh
npm install
git config core.hooksPath .githooks
cp .env.example .env   # add your key; .env is git-ignored

npm run dev        # start the app: select text, press Ctrl+Shift+Space; Ctrl+Alt+Esc quits
npm test           # Vitest, all workspaces
npm run lint       # Biome
npm run typecheck  # tsc, all workspaces
```

Settings live in `%APPDATA%\omnitrix\settings.json` (created with defaults on first run).

## License

MIT
