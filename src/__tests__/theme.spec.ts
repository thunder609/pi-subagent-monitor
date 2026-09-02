import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectTheme, themeColors } from "../theme";

describe("detectTheme", () => {
  const originalColorFgBg = process.env.COLORFGBG;
  const originalTerm = process.env.TERM;

  beforeEach(() => {
    delete process.env.COLORFGBG;
    delete process.env.TERM;
  });

  afterEach(() => {
    if (originalColorFgBg === undefined) delete process.env.COLORFGBG;
    else process.env.COLORFGBG = originalColorFgBg;
    if (originalTerm === undefined) delete process.env.TERM;
    else process.env.TERM = originalTerm;
  });

  it("returns dark when no env hints are present", () => {
    expect(detectTheme()).toBe("dark");
  });

  it("returns dark when COLORFGBG foreground is a typical dark color", () => {
    process.env.COLORFGBG = "0;default";
    expect(detectTheme()).toBe("dark");
  });

  it("returns light when COLORFGBG foreground is white (15)", () => {
    process.env.COLORFGBG = "15;default";
    expect(detectTheme()).toBe("light");
  });

  it("returns light when COLORFGBG foreground is bright white (231 in xterm 256)", () => {
    process.env.COLORFGBG = "231;default";
    expect(detectTheme()).toBe("light");
  });

  it("returns light when TERM ends with -light", () => {
    process.env.TERM = "xterm-256color-light";
    expect(detectTheme()).toBe("light");
  });

  it("returns dark when TERM does not match the light hint and COLORFGBG is dark", () => {
    process.env.TERM = "xterm-256color";
    process.env.COLORFGBG = "0;default";
    expect(detectTheme()).toBe("dark");
  });

  it("returns dark when COLORFGBG is malformed (non-numeric)", () => {
    process.env.COLORFGBG = "garbage;default";
    expect(detectTheme()).toBe("dark");
  });

  it("returns dark when COLORFGBG is missing the semicolon", () => {
    process.env.COLORFGBG = "15";
    expect(detectTheme()).toBe("dark");
  });
});

describe("themeColors", () => {
  it("returns a non-empty palette for dark", () => {
    const palette = themeColors("dark");
    expect(palette).toBeTypeOf("object");
    expect(Object.keys(palette).length).toBeGreaterThan(0);
  });

  it("returns a non-empty palette for light", () => {
    const palette = themeColors("light");
    expect(palette).toBeTypeOf("object");
    expect(Object.keys(palette).length).toBeGreaterThan(0);
  });

  it("returns different palettes for the two themes", () => {
    const dark = themeColors("dark");
    const light = themeColors("light");
    expect(JSON.stringify(dark)).not.toBe(JSON.stringify(light));
  });
});