import { describe, it, expect } from "vitest";
import { defineMdastPlugin } from "../src/plugin.js";

describe("defineMdastPlugin", () => {
  it("returns the definition unchanged (identity)", () => {
    const def = {
      name: "my-plugin",
      createOnce() {
        return {};
      },
    };
    const result = defineMdastPlugin(def);
    expect(result).toBe(def);
  });

  it("throws if name is missing", () => {
    expect(() =>
      defineMdastPlugin({
        name: "",
        createOnce() {
          return {};
        },
      }),
    ).toThrow(/name/);
  });

  it("throws if name is absent entirely", () => {
    expect(() =>
      defineMdastPlugin({
        createOnce() {
          return {};
        },
      } as unknown as Parameters<typeof defineMdastPlugin>[0]),
    ).toThrow(/name/);
  });

  it("throws if createOnce is missing", () => {
    expect(() =>
      defineMdastPlugin({ name: "x" } as unknown as Parameters<typeof defineMdastPlugin>[0]),
    ).toThrow(/createOnce/);
  });

  it("throws if createOnce is not a function", () => {
    expect(() =>
      defineMdastPlugin({ name: "x", createOnce: 42 } as unknown as Parameters<
        typeof defineMdastPlugin
      >[0]),
    ).toThrow(/createOnce/);
  });

  it("works with a minimal valid definition", () => {
    const def = defineMdastPlugin({
      name: "minimal",
      createOnce() {
        return {};
      },
    });
    expect(def.name).toBe("minimal");
    expect(typeof def.createOnce).toBe("function");
  });
});
