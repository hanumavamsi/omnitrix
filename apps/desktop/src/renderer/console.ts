import type { Settings } from "@omnitrix/agent";
import type {
	ConsoleApi,
	ConsoleState,
	ProviderView,
} from "../preload/console.ts";

declare global {
	interface Window {
		omniConsole: ConsoleApi;
	}
}

const api = window.omniConsole;
const providersBox = document.getElementById("providers") as HTMLElement;
const form = document.getElementById("settings-form") as HTMLFormElement;
const status = document.getElementById("status") as HTMLElement;

// "Error invoking remote method 'x': Error: msg" -> "msg"
const messageOf = (error: unknown) =>
	String(error instanceof Error ? error.message : error).replace(
		/^.*Error: /,
		"",
	);

function showStatus(text: string, isError = false) {
	status.textContent = text;
	status.className = isError ? "error" : "";
}

// Small DOM builder: el("p", { className: "x" }, "text", child)
function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: object = {},
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...children);
	return node;
}

// Runs a key action, then redraws the key section from what main returns.
async function keyAction(action: () => Promise<ConsoleState>, done: string) {
	try {
		renderProviders((await action()).providers);
		showStatus(done);
	} catch (error) {
		showStatus(messageOf(error), true);
	}
}

function keyInput(provider: ProviderView) {
	const input = el("input", {
		type: "password",
		placeholder: "Paste your API key",
		autocomplete: "off",
		spellcheck: false,
	});
	const save = el("button", { type: "button", textContent: "Save key" });
	const submit = () =>
		keyAction(() => api.setKey(provider.id, input.value), "Key saved");
	save.addEventListener("click", submit);
	input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
	return el("div", { className: "row" }, input, save);
}

function renderProvider(provider: ProviderView) {
	const box = el("div", { className: "provider" }, el("h3", {}, provider.name));
	if (provider.key === "env") {
		box.append(
			el("p", {}, `Using ${provider.envVar} from the environment (dev).`),
		);
	} else if (provider.key === "saved") {
		const replace = el("button", { type: "button", textContent: "Replace" });
		const clear = el("button", { type: "button", textContent: "Clear" });
		const row = el(
			"div",
			{ className: "row" },
			el("span", { className: "ok" }, "Key saved"),
			replace,
			clear,
		);
		replace.addEventListener("click", () =>
			row.replaceWith(keyInput(provider)),
		);
		clear.addEventListener("click", () =>
			keyAction(() => api.clearKey(provider.id), "Key cleared"),
		);
		box.append(row);
	} else {
		box.append(keyInput(provider));
	}
	const link = el("a", { href: "#", textContent: "Get a key" });
	link.addEventListener("click", (e) => {
		e.preventDefault();
		api.openKeyPage(provider.id);
	});
	box.append(el("p", { className: "warning" }, provider.warning, " ", link));
	return box;
}

function renderProviders(providers: ProviderView[]) {
	providersBox.replaceChildren(...providers.map(renderProvider));
}

// Inputs are named after the Settings keys, so one loop fills and one loop reads them.
function fillForm(settings: Settings) {
	for (const [key, value] of Object.entries(settings)) {
		const field = form.elements.namedItem(key) as HTMLInputElement | null;
		if (!field) continue;
		if (field.type === "checkbox") field.checked = value as boolean;
		else field.value = String(value);
	}
}

function readForm(): Settings {
	const settings: Record<string, unknown> = {};
	for (const field of Array.from(form.elements) as HTMLInputElement[]) {
		if (!field.name) continue;
		settings[field.name] =
			field.type === "checkbox" ? field.checked : field.value.trim();
	}
	return settings as Settings; // main validates it
}

// Every change saves at once; main applies it without a restart.
form.addEventListener("change", async () => {
	try {
		fillForm(await api.saveSettings(readForm()));
		showStatus("Saved");
	} catch (error) {
		showStatus(messageOf(error), true);
	}
});
form.addEventListener("submit", (e) => e.preventDefault());

api.getState().then((state) => {
	renderProviders(state.providers);
	fillForm(state.settings);
});
