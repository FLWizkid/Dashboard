import { describe, it, expect } from "vitest";
import { isUndefinedTable } from "./pg";

describe("isUndefinedTable", () => {
  it("is true for a 42P01 error", () => {
    expect(isUndefinedTable({ code: "42P01" })).toBe(true);
  });

  it("is false for other error codes", () => {
    expect(isUndefinedTable({ code: "23505" })).toBe(false);
  });

  it("is false for null", () => {
    expect(isUndefinedTable(null)).toBe(false);
  });

  it("is false when the code is absent", () => {
    expect(isUndefinedTable({})).toBe(false);
  });
});
