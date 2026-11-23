// Markdown + KaTeX to HTML. Pure, so tests run without a DOM; the caller sanitizes.
import katex from "katex";
import { Marked, type TokenizerAndRendererExtension } from "marked";
import markedKatex from "marked-katex-extension";

// Pandoc's rule: no space just inside the $ pair, no digit right after it.
// Accepts "$n$-th" (the extension's rule wants a space after the closing $), leaves "$5 and $10" as text.
const inlineMathRule = /^\$(?!\s)((?:\\.|[^\\\n$])+?)(?<!\s)\$(?!\d)/;

const inlineMath: TokenizerAndRendererExtension = {
	name: "inlineMath",
	level: "inline",
	start(src) {
		for (let i = src.indexOf("$"); i !== -1; i = src.indexOf("$", i + 1))
			if (inlineMathRule.test(src.slice(i))) return i;
	},
	tokenizer(src) {
		const match = inlineMathRule.exec(src);
		if (match) return { type: "inlineMath", raw: match[0], text: match[1] };
	},
	renderer: (token) =>
		katex.renderToString(token.text, { throwOnError: false }),
};

const marked = new Marked(markedKatex({ throwOnError: false }), {
	extensions: [inlineMath], // registered last, so it runs before the extension's inline rule
});

export function markdownToHtml(text: string) {
	return marked.parse(text, { async: false });
}
