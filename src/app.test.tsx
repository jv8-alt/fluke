/**
 * Render smoke test: the full app server-renders with the paper-mode data,
 * and the opening screen tells the story's first beat (the naive scoreboard).
 */
import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { App } from "./ui/App";

describe("App", () => {
  it("renders the opening scoreboard state", () => {
    const html = render(<App />);
    expect(html).toContain("Error Bars");
    expect(html).toContain("MATH");
    expect(html).toContain("HumanEval");
    expect(html).toContain("MGSM");
    expect(html).toContain("Galleon");
    expect(html).toContain("Dreadnought");
    // step 1 claim: naive scoreboard reading, computed from data
    expect(html).toContain("Dreadnought wins 2 of 3");
    // no margins shown before the toggle turns on
    expect(html).not.toContain("±");
  });
});
