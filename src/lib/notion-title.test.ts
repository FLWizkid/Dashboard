import { describe, it, expect } from "vitest";
import { extractTitle } from "./notion-title";

describe("extractTitle", () => {
  it("reads the title property regardless of its name", () => {
    const properties = {
      Name: {
        type: "title",
        title: [{ plain_text: "Quarterly " }, { plain_text: "review" }],
      },
      Status: { type: "select", select: { name: "Open" } },
    };
    expect(extractTitle(properties)).toBe("Quarterly review");
  });

  it("returns 'Untitled' when the title is empty", () => {
    const properties = { Name: { type: "title", title: [] } };
    expect(extractTitle(properties)).toBe("Untitled");
  });

  it("returns 'Untitled' when there is no title property", () => {
    const properties = { Status: { type: "select", select: { name: "Open" } } };
    expect(extractTitle(properties)).toBe("Untitled");
  });

  it("ignores non-string rich-text fragments", () => {
    const properties = {
      Name: { type: "title", title: [{ plain_text: "OK" }, { plain_text: 42 }] },
    };
    expect(extractTitle(properties)).toBe("OK");
  });
});
