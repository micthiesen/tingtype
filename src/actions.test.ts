import { describe, expect, it } from "bun:test";
import { parseKeySpec, toCliclickArgs } from "./actions.js";

describe("parseKeySpec", () => {
  it("maps opt/alt to alt and recognizes named keys", () => {
    expect(parseKeySpec("ctrl+opt+space")).toEqual({
      modifiers: ["ctrl", "alt"],
      key: "space",
      named: true,
    });
  });

  it("aliases enter to return", () => {
    expect(parseKeySpec("return")).toEqual({
      modifiers: [],
      key: "return",
      named: true,
    });
    expect(parseKeySpec("enter")).toEqual({
      modifiers: [],
      key: "return",
      named: true,
    });
  });

  it("treats a single character as a typed key", () => {
    expect(parseKeySpec("cmd+a")).toEqual({
      modifiers: ["cmd"],
      key: "a",
      named: false,
    });
  });

  it("is case-insensitive and tolerant of whitespace", () => {
    expect(parseKeySpec(" CMD + Shift + Space ")).toEqual({
      modifiers: ["cmd", "shift"],
      key: "space",
      named: true,
    });
  });

  it("rejects unknown modifiers and empty specs", () => {
    expect(() => parseKeySpec("hyper+space")).toThrow();
    expect(() => parseKeySpec("")).toThrow();
  });
});

describe("toCliclickArgs", () => {
  it("wraps modified keys with key-down/key-up", () => {
    expect(toCliclickArgs(parseKeySpec("ctrl+opt+space"))).toEqual([
      "kd:ctrl,alt",
      "kp:space",
      "ku:ctrl,alt",
    ]);
  });

  it("emits a bare keypress with no modifiers", () => {
    expect(toCliclickArgs(parseKeySpec("return"))).toEqual(["kp:return"]);
  });

  it("uses t: for typed characters", () => {
    expect(toCliclickArgs(parseKeySpec("cmd+a"))).toEqual(["kd:cmd", "t:a", "ku:cmd"]);
  });
});
