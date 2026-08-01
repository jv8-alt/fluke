// Smoke test proving the Vitest + TS + JSX toolchain works end to end.
import { describe, expect, it } from "vitest";
import { App } from "./app";

describe("scaffold", () => {
  it("App is a renderable component", () => {
    const vnode = <App />;
    expect(vnode.type).toBe(App);
  });
});
