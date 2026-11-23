// Strips obvious secrets from text before it leaves the machine (L5). Pure: text in, redacted text + count out.

export const REDACTED = "[redacted secret]";

// `NAME=value` env/config lines, where NAME is upper-case and mentions a secret. Keeps the name, hides the value.
const SECRET_LINE =
	/^([ \t]*(?:export[ \t]+)?[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|(?:API|ACCESS|PRIVATE)_?KEY)[A-Z0-9_]*[ \t]*[:=][ \t]*)\S+/gm;

// `password = "..."` / `"apiKey": "..."` in code. Only quoted values, so `token = getToken()` survives.
const SECRET_STRING =
	/\b([\w-]*?(?:password|passwd|secret|token|api_?key)["']?[ \t]*[:=][ \t]*)(["'])[^"'\n]+\2/gi;

// Known key shapes. \b stops matches inside longer words such as "task-...".
const KEY_SHAPES = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	/\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g, // JWT: base64 of '{"' twice, then a signature
	/\bAIza[\w-]{35}/g, // Google
	/\bsk-(?=[\w-]*\d)[\w-]{20,}/g, // OpenAI / Anthropic
	/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}/g, // GitHub
	/\bgithub_pat_\w{22,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
	/\b[spr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, // Stripe
	/(?<=\bBearer )[\w.~+/-]{20,}=*/g,
];

// Long runs of base64-ish characters; only the random-looking ones are secrets.
const LONG_RUN = /[A-Za-z0-9+/_=-]{32,}/g;

export function redact(input: string): { text: string; count: number } {
	let count = 0;
	// Assignments run first, so a key-shaped value on a PASSWORD= line counts once.
	let text = input
		.replace(SECRET_LINE, (_match, name: string) => {
			count++;
			return name + REDACTED;
		})
		.replace(SECRET_STRING, (_match, name: string, quote: string) => {
			count++;
			return name + quote + REDACTED + quote;
		});
	for (const shape of KEY_SHAPES) {
		text = text.replace(shape, () => {
			count++;
			return REDACTED;
		});
	}
	text = text.replace(LONG_RUN, (run) => {
		if (!looksRandom(run)) return run;
		count++;
		return REDACTED;
	});
	return { text, count };
}

// Mixed case + digits rules out git hashes and UUIDs (hex); 4.5 bits/char rules out long identifiers (~4.3).
function looksRandom(run: string) {
	if (!/[a-z]/.test(run) || !/[A-Z]/.test(run) || !/\d/.test(run)) return false;
	return entropy(run) >= 4.5;
}

// Shannon entropy in bits per character.
function entropy(s: string) {
	const counts = new Map<string, number>();
	for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
	let bits = 0;
	for (const n of counts.values())
		bits -= (n / s.length) * Math.log2(n / s.length);
	return bits;
}
