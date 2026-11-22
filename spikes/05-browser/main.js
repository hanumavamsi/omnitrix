// Spike 5: Playwright + dedicated Chrome profile on the target sites.
// Measures: snapshot size, bot blocking, and element box (CSS px) -> screen point for the ghost cursor.
// Run: npx electron spikes/05-browser/main.js [siteName ...]   (no args = all sites)
// Output: one JSON line per measurement; snapshots saved to %TEMP%/omnitrix-spike5 (page content stays off the repo).
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, screen } from "electron";
import koffi from "koffi";
import { chromium } from "playwright-core";

const SITES = {
	flights: "https://www.google.com/travel/flights",
	indigo: "https://www.goindigo.in/",
	airindia: "https://www.airindia.com/",
	youtube: "https://www.youtube.com/",
};
const BLOCKED =
	/captcha|access denied|unusual traffic|are you a robot|verify you are human|request blocked|forbidden/i;

const outDir = join(tmpdir(), "omnitrix-spike5");
mkdirSync(outDir, { recursive: true });
// D6: dedicated profile, never the user's real one. Outside the repo; P2 moves it to %APPDATA%\omnitrix.
const profileDir = join(
	process.env.LOCALAPPDATA ?? tmpdir(),
	"omnitrix-spike5",
	"chrome-profile",
);

const user32 = koffi.load("user32.dll");
const SetCursorPos = user32.func("bool __stdcall SetCursorPos(int x, int y)");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (o) => console.log(JSON.stringify(o));

// Ghost cursor stand-in: a click-through dot overlay per display, drawn in Electron DIP.
// No content protection here, so a tester's screenshots can see the dot.
const overlays = new Map();
function createOverlays() {
	for (const d of screen.getAllDisplays()) {
		const win = new BrowserWindow({
			...d.bounds,
			show: false,
			frame: false,
			transparent: true,
			focusable: false,
			skipTaskbar: true,
			hasShadow: false,
			webPreferences: { sandbox: true },
		});
		win.setBounds(d.bounds);
		win.setIgnoreMouseEvents(true);
		win.setAlwaysOnTop(true, "screen-saver");
		win.loadURL(
			`data:text/html,${encodeURIComponent(
				`<body style="margin:0;background:transparent"><div id="d" style="position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:2px solid #00ff66;box-sizing:border-box;display:none"></div>`,
			)}`,
		);
		overlays.set(d.id, { win, d });
	}
}
async function ghost(dip) {
	const d = screen.getDisplayNearestPoint(dip);
	for (const o of overlays.values()) o.win.hide();
	const { win } = overlays.get(d.id);
	await win.webContents.executeJavaScript(
		`Object.assign(d.style,{left:"${dip.x - d.bounds.x}px",top:"${dip.y - d.bounds.y}px",display:"block"}); 0`,
	);
	win.showInactive();
}

async function measureSnapshot(page, name) {
	const t0 = performance.now();
	const plain = await page.ariaSnapshot();
	const ai = await page.ariaSnapshot({ mode: "ai" });
	writeFileSync(join(outDir, `${name}.ai.yaml`), ai);
	const title = await page.title();
	return {
		title,
		snapshot_ms: Math.round(performance.now() - t0),
		plain_chars: plain.length,
		ai_chars: ai.length,
		ai_lines: ai.split("\n").length,
		ai_refs: (ai.match(/\[ref=/g) ?? []).length,
		ai_tokens_est: Math.round(ai.length / 4), // shortcut: chars/4 estimate, use the model's countTokens for real numbers
		blockedHint: BLOCKED.test(title) || BLOCKED.test(ai.slice(0, 4000)),
	};
}

// Box (CSS px, viewport-relative) -> Electron DIP screen point -> physical; then move the real cursor there
// and ask the page where the mouse landed. The difference is the mapping error.
async function measureMapping(page) {
	const target = page
		.locator("input:visible, button:visible, [role=combobox]:visible")
		.first();
	const box = await target.boundingBox({ timeout: 5000 }).catch(() => null);
	if (!box) return { mapping: "no visible target" };
	await page.bringToFront();
	const g = await page.evaluate(() => ({
		screenX,
		screenY,
		outerWidth,
		outerHeight,
		innerWidth,
		innerHeight,
		dpr: devicePixelRatio,
	}));
	const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	// Viewport origin guess: side border = half the width difference; the rest of the height difference is the top UI.
	const border = (g.outerWidth - g.innerWidth) / 2;
	const origin = {
		x: g.screenX + border,
		y: g.screenY + (g.outerHeight - g.innerHeight - border),
	};
	const display = screen.getDisplayNearestPoint({
		x: Math.round(origin.x),
		y: Math.round(origin.y),
	});
	const zoom = g.dpr / display.scaleFactor; // CSS px -> DIP (1 unless the page is zoomed)
	const dip = {
		x: Math.round(origin.x + c.x * zoom),
		y: Math.round(origin.y + c.y * zoom),
	};
	const phys = screen.dipToScreenPoint(dip);

	await page.evaluate(() => {
		window.__m = null;
		addEventListener("mousemove", (e) => {
			window.__m = {
				cx: e.clientX,
				cy: e.clientY,
				sx: e.screenX,
				sy: e.screenY,
			};
		});
	});
	SetCursorPos(phys.x - 3, phys.y - 3); // move twice so a mousemove fires even if already there
	await sleep(50);
	SetCursorPos(phys.x, phys.y);
	await sleep(150);
	const m = await page.evaluate(() => window.__m);
	await ghost(dip);
	return {
		target: await target.evaluate(
			(el) =>
				`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} ${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}`,
		),
		display: { id: display.id, scale: display.scaleFactor },
		geom: g,
		box_center_css: c,
		dip,
		phys,
		landed_css: m && { x: m.cx, y: m.cy },
		error_css: m && {
			dx: +(m.cx - c.x).toFixed(1),
			dy: +(m.cy - c.y).toFixed(1),
		},
		// Exact viewport origin as the page sees it (screenX - clientX); compare with our guess.
		origin_guess: origin,
		origin_true: m && { x: m.sx - m.cx, y: m.sy - m.cy },
	};
}

async function moveWindowTo(context, page, display) {
	const cdp = await context.newCDPSession(page);
	const { windowId } = await cdp.send("Browser.getWindowForTarget");
	const wa = display.workArea;
	await cdp.send("Browser.setWindowBounds", {
		windowId,
		bounds: { windowState: "normal" },
	});
	await cdp.send("Browser.setWindowBounds", {
		windowId,
		bounds: {
			left: wa.x + 40,
			top: wa.y + 40,
			width: Math.min(1200, wa.width - 80),
			height: Math.min(800, wa.height - 80),
		},
	});
	await sleep(500);
}

async function run() {
	createOverlays();
	const names = process.argv.slice(2).filter((a) => a in SITES);
	const sites = names.length ? names : Object.keys(SITES);
	const context = await chromium.launchPersistentContext(profileDir, {
		channel: "chrome", // the user's installed Chrome, no Playwright browser download
		headless: false,
		viewport: null, // real window size, so CSS px match the window
	});
	const page = context.pages()[0] ?? (await context.newPage());
	const displays = screen.getAllDisplays();
	log({
		chrome: context.browser()?.version(),
		profileDir,
		displays: displays.map((d) => ({
			id: d.id,
			bounds: d.bounds,
			scale: d.scaleFactor,
		})),
	});

	for (const name of sites) {
		for (const display of displays) {
			await moveWindowTo(context, page, display);
			const t0 = performance.now();
			let status = null;
			try {
				const res = await page.goto(SITES[name], {
					waitUntil: "domcontentloaded",
					timeout: 45_000,
				});
				status = res?.status() ?? null;
				await page
					.waitForLoadState("load", { timeout: 15_000 })
					.catch(() => {});
				await sleep(2000); // let late UI (cookie banners, SPA hydration) settle
			} catch (e) {
				log({ site: name, error: String(e).slice(0, 300) });
				continue;
			}
			const load_ms = Math.round(performance.now() - t0);
			const webdriver = await page.evaluate(() => navigator.webdriver);
			const snap =
				display === displays[0] ? await measureSnapshot(page, name) : {};
			await page.screenshot({
				path: join(outDir, `${name}-${display.id}.png`),
			});
			const mapping = await measureMapping(page).catch((e) => ({
				mapping: String(e).slice(0, 200),
			}));
			log({
				site: name,
				display: display.id,
				status,
				load_ms,
				webdriver,
				...snap,
				...mapping,
			});
			await sleep(1500); // ghost dot visible for screenshots
		}
	}
	await context.close();
	app.quit();
}

app.whenReady().then(() =>
	run().catch((e) => {
		console.error(e);
		app.quit();
	}),
);
app.on("window-all-closed", () => {});
