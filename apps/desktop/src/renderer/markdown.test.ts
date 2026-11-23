import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./markdown.ts";

const mathCount = (html: string) => html.split('class="katex"').length - 1;

describe("markdownToHtml", () => {
	it("renders math glued to a word", () => {
		const html = markdownToHtml("the $n$-th term is $a_n$.");
		expect(html).not.toContain("katex-error");
		expect(mathCount(html)).toBe(2);
	});

	it("leaves prices as text", () => {
		const html = markdownToHtml("costs $5 and $10 today");
		expect(mathCount(html)).toBe(0);
		expect(html).toContain("$5 and $10");
	});

	it("still renders spaced inline and block math", () => {
		expect(mathCount(markdownToHtml("so $e^{i\\pi}+1=0$ holds"))).toBe(1);
		expect(markdownToHtml("$$\nx^2\n$$")).toContain("katex-display");
	});
});
