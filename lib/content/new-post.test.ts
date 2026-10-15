import { describe, expect, it } from "vitest";
import { isPlaceholderTitle, NEW_POST_TITLE } from "./new-post";

describe("crear una pieza desde el drawer", () => {
  it("reconoce el titulo que puso el sistema, y solo ese", () => {
    expect(isPlaceholderTitle(NEW_POST_TITLE)).toBe(true);
    expect(isPlaceholderTitle(`  ${NEW_POST_TITLE} `)).toBe(true);
    expect(isPlaceholderTitle("Mi primer reel")).toBe(false);
    expect(isPlaceholderTitle("")).toBe(false);
  });
});
