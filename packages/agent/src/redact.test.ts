import { describe, expect, it } from "vitest";
import { REDACTED, redact } from "./redact.ts";

// All fixtures are fake. Built from pieces so secret scanners don't flag this file.
const google = `AIza${"FAKE".repeat(8)}abc`; // AIza + 35
const openai = `sk-${"proj-FAKE0".repeat(4)}`;
const github = `ghp_${"FAKE0".repeat(7)}a`; // ghp_ + 36
const githubPat = `github_pat_${"FAKE0".repeat(6)}`;
const aws = `AKIA${"FAKE0000".repeat(2)}`; // AKIA + 16
const slack = `xoxb-${"1234-FAKE-".repeat(3)}`;
const stripe = `sk_live_${"FAKE0".repeat(5)}`;
const jwt = `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.${"FAKEsig0".repeat(4)}`;
const pem = [
	`-----BEGIN RSA ${"PRIVATE"} KEY-----`,
	"FAKEFAKEFAKE",
	`-----END RSA ${"PRIVATE"} KEY-----`,
].join("\n");
// Every character different, so it is as "random" as a 40-char string gets.
const random = "FakeRandom" + "0123456789" + "abcdefghij" + "KLMNOPQRST";

describe("redact", () => {
	it.each([
		["Google API key", `key: ${google}`, `key: ${REDACTED}`],
		["OpenAI key", `use ${openai} here`, `use ${REDACTED} here`],
		["GitHub token", `token ${github}`, `token ${REDACTED}`],
		["GitHub fine-grained PAT", githubPat, REDACTED],
		["AWS access key id", `id ${aws}`, `id ${REDACTED}`],
		["Slack token", slack, REDACTED],
		["Stripe key", stripe, REDACTED],
		["JWT", `Cookie: session=${jwt}`, `Cookie: session=${REDACTED}`],
		[
			"private key block",
			`before\n${pem}\nafter`,
			`before\n${REDACTED}\nafter`,
		],
		[
			"Bearer header",
			`Authorization: Bearer ${"fake0".repeat(5)}`,
			`Authorization: Bearer ${REDACTED}`,
		],
		["PASSWORD= line", "DB_PASSWORD=hunter2", `DB_PASSWORD=${REDACTED}`],
		[
			"export SECRET= line",
			"export CLIENT_SECRET=abc123",
			`export CLIENT_SECRET=${REDACTED}`,
		],
		["TOKEN: line", "  AUTH_TOKEN: xyz", `  AUTH_TOKEN: ${REDACTED}`],
		["API_KEY= line", "GEMINI_API_KEY=whatever", `GEMINI_API_KEY=${REDACTED}`],
		[
			"quoted password in code",
			`const password = "hunter2";`,
			`const password = "${REDACTED}";`,
		],
		["quoted apiKey in JSON", `{"apiKey": "abc"}`, `{"apiKey": "${REDACTED}"}`],
		["long high-entropy string", `blob ${random} end`, `blob ${REDACTED} end`],
	])("redacts a %s", (_name, input, expected) => {
		expect(redact(input)).toEqual({ text: expected, count: 1 });
	});

	it("redacts several secrets in one input and counts each", () => {
		const input = `GOOGLE=${google}\nconst gh = "${github}";\nPASSWORD=x\n${jwt}`;
		expect(redact(input)).toEqual({
			text: `GOOGLE=${REDACTED}\nconst gh = "${REDACTED}";\nPASSWORD=${REDACTED}\n${REDACTED}`,
			count: 4,
		});
	});

	it.each([
		["git hash", "commit dbdc6cc4f1e2a3b4c5d6e7f8091a2b3c4d5e6f70"],
		["short git hash", "fixed in dbdc6cc"],
		["UUID", "id 550e8400-e29b-41d4-a716-446655440000"],
		["upper-case UUID", "id 550E8400-E29B-41D4-A716-446655440000"],
		["token read from a call", "const token = getToken(user);"],
		["password property access", "if (password === user.password) login();"],
		["label naming a password", `const passwordLabel = "Enter password";`],
		["empty env value", "PASSWORD="],
		["kebab-case words", "the task-manager-component-name-is-long"],
		["long identifier", "AbstractSingletonProxyFactoryBeanImpl2"],
		["URL", "https://github.com/hanumavamsi/omnitrix/issues/3?tab=comments"],
		["file path", "D:/Hanuma/omnitrix/packages/agent/src/look.test.ts"],
		["prose", "Secrets like passwords should never be committed."],
		["SQL", "SELECT id, token_type FROM sessions WHERE user_id = 42;"],
	])("leaves a %s untouched", (_name, input) => {
		expect(redact(input)).toEqual({ text: input, count: 0 });
	});
});
