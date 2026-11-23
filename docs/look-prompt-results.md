# Look prompt results (#8)

`LOOK_SYSTEM_PROMPT` in `packages/agent/src/look.ts`, run against `packages/agent/fixtures/look/` with the default settings (Look model `google:gemini-flash-lite-latest`, fallback `google:gemini-flash-latest`). Region fixtures were sent without a question, so they use `DEFAULT_REGION_PROMPT`.

Re-run (costs about 8 free-tier requests), from the repo root:

```
node --experimental-transform-types --env-file=.env packages/agent/scripts/run-fixtures.ts
```

Run of 2026-11-23, first prompt draft, no fallback needed:

| Fixture | Type | Verdict |
| --- | --- | --- |
| chart.png | chart | Fits: gives low (42k), peak (184k), biggest jump May to June, and the takeaway. Spike 4's missing numbers are fixed |
| chart.png follow-up | follow-up | Fits: answers the "why" with likely causes |
| code.txt | code | Fits: says it's a debounce and when you'd use it, 2 sentences |
| foreign.txt | German | Fits: names the language, accurate English translation |
| math.png | math (image) | Fits: antiderivative, bounds, result 6 (correct), in KaTeX |
| math.txt | math (text) | Fits: product rule, result $2x \sin x + x^2 \cos x$ (correct) |
| table.txt | table | Fits: highest and lowest values with the trend per region |
| term.txt | term | Fits: definition, an example, where it's used in computing |

## Answers

### chart.png

This bar chart shows monthly active users in thousands from January to June 2026. User numbers reached a low of 42 thousand in January and peaked at 184 thousand in June, with the biggest growth surge occurring between May and June. The overall takeaway is strong, accelerating user growth over the first half of the year.

#### Follow-up: Why might June jump so much?

June's massive jump could be driven by several major events, such as a highly successful marketing campaign, a major product launch or feature update, or securing critical seasonal demand. Viral social media traction or a sudden surge in media coverage can also cause explosive month-over-month growth of this scale.

### code.txt

This JavaScript utility limits how often a function can run by waiting for a pause in events. You'd use it to optimize performance on frequent actions like window resizing, typing searches, or button clicks.

### foreign.txt

This German text translates to: "Unfortunately, the delivery is delayed by two weeks because a component is missing. We will get in touch as soon as we have a new date." It is a standard logistical notification informing a customer about a supply chain delay.

### math.png

Find the antiderivative term by term: $\int (3x^2 - 2x + 1) \,dx = x^3 - x^2 + x$. Evaluate this expression from the lower limit $0$ to the upper limit $2$: $(2^3 - 2^2 + 2) - (0^3 - 0^2 + 0)$. The final result is $6$.

### math.txt

This derivative is found using the product rule: $\frac{d}{dx}[f(x)g(x)] = f'(x)g(x) + f(x)g'(x)$. 
Applying this to $x^2$ and $\sin x$, the derivative of $x^2$ is $2x$ and the derivative of $\sin x$ is $\cos x$. 
The resulting expression is $2x \sin x + x^2 \cos x$.

### table.txt

North reached the highest value at 1.62M in Q3, while South saw the lowest at 0.87M in the same quarter. The key takeaway is that North experienced steady growth, whereas South showed a continuous decline.

### term.txt

An operation that produces the exact same result no matter how many times you apply it. For example, multiplying a number by zero is idempotent because $x \times 0 \times 0 = 0$. In computing, it ensures that repeating a network request or database write won't cause unintended side effects.

