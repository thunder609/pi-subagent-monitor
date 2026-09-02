import { describe, it, expect } from "vitest";
import type { ViewMode } from "../types";
import { VIEW_MODE_DETAIL_ALIAS } from "../types";

describe("ViewMode", () => {
  it("narrows on the new 'drawer' literal at compile time", () => {
    const mode: ViewMode = "drawer";
    expect(mode).toBe("drawer");
  });

  it("narrows on the legacy 'list' literal at compile time", () => {
    const mode: ViewMode = "list";
    expect(mode).toBe("list");
  });

  it("rejects unrelated string literals at compile time", () => {
    // @ts-expect-error — "foo" is not a valid ViewMode literal.
    const _invalid: ViewMode = "foo";
    expect(_invalid).toBe("foo");
  });

  it("exposes a deprecated alias constant equal to the legacy 'detail' literal", () => {
    expect(VIEW_MODE_DETAIL_ALIAS).toBe("detail");
  });
});