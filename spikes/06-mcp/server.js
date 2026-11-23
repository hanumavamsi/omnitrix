// Spike 6: MCP server over Streamable HTTP on 127.0.0.1 with bearer token, Host/Origin checks and a one-task lock.
// Run: node spikes/06-mcp/server.js   (plain Node: packages/mcp-server must not depend on Electron, D5/D11)
// Prints the URL; writes a Claude Code --mcp-config file (with the token) to %TEMP%/omnitrix-spike6, never the repo.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.OMNITRIX_MCP_PORT ?? 47823);
// shortcut: new token every run; P2 generates once on first run and stores it with safeStorage (D5, D17).
const TOKEN = randomBytes(32).toString("base64url");
const okHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const log = (o) =>
	console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

let busy = null; // D5: one task at a time, across every client
function buildServer() {
	const server = new McpServer({ name: "omnitrix-spike6", version: "0.0.1" });
	server.registerTool(
		"ping",
		{
			description: "Health check. Returns pong and the server time.",
			inputSchema: { note: z.string().optional() },
		},
		async ({ note }) => ({
			content: [
				{
					type: "text",
					text: `pong ${new Date().toISOString()}${note ? ` (${note})` : ""}`,
				},
			],
		}),
	);
	server.registerTool(
		"slow_task",
		{
			description:
				"Pretend task that holds the one-task lock for N seconds (max 30). Used to test the lock.",
			inputSchema: { seconds: z.number().min(0).max(30) },
		},
		async ({ seconds }) => {
			if (busy)
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `busy: task "${busy}" is running, try later`,
						},
					],
				};
			busy = `slow_task ${seconds}s`;
			try {
				await new Promise((r) => setTimeout(r, seconds * 1000));
				return { content: [{ type: "text", text: `done after ${seconds}s` }] };
			} finally {
				busy = null;
			}
		},
	);
	return server;
}

function deny(res, code, why) {
	res
		.writeHead(code, { "content-type": "application/json" })
		.end(JSON.stringify({ error: why }));
	return why;
}
function tokenOk(header) {
	const got = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
	const want = Buffer.from(TOKEN);
	return got.length === want.length && timingSafeEqual(got, want);
}

createServer(async (req, res) => {
	const t0 = performance.now();
	const meta = {
		method: req.method,
		url: req.url,
		host: req.headers.host,
		origin: req.headers.origin ?? null,
	};
	// Order: Host (DNS rebinding) -> Origin (browser pages) -> token. Each check rejects before any MCP parsing.
	let denied = null;
	if (!okHosts.has(req.headers.host ?? "")) denied = deny(res, 403, "bad host");
	else if (req.headers.origin)
		denied = deny(res, 403, "browser origin not allowed"); // CLI clients send no Origin
	else if (!tokenOk(req.headers.authorization))
		denied = deny(res, 401, "bad or missing token");
	else if (req.url !== "/mcp") denied = deny(res, 404, "not found");
	if (denied) return log({ ...meta, denied });

	// Stateless: fresh server+transport per request (SDK pattern); the lock lives outside, so it still spans clients.
	const server = buildServer();
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	res.on("close", () => {
		transport.close();
		server.close();
	});
	try {
		await server.connect(transport);
		await transport.handleRequest(req, res);
	} catch (e) {
		if (!res.headersSent) deny(res, 500, "internal error");
		log({ ...meta, error: String(e).slice(0, 200) });
	}
	log({
		...meta,
		status: res.statusCode,
		ms: Math.round(performance.now() - t0),
	});
}).listen(PORT, "127.0.0.1", () => {
	const dir = join(tmpdir(), "omnitrix-spike6");
	mkdirSync(dir, { recursive: true });
	const cfg = join(dir, "mcp.json");
	writeFileSync(
		cfg,
		JSON.stringify(
			{
				mcpServers: {
					omnitrix: {
						type: "http",
						url: `http://127.0.0.1:${PORT}/mcp`,
						headers: { Authorization: `Bearer ${TOKEN}` },
					},
				},
			},
			null,
			2,
		),
	);
	log({ ready: `http://127.0.0.1:${PORT}/mcp`, mcpConfig: cfg });
});
