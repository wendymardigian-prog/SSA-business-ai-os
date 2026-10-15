import { describe, expect, it } from "vitest";
import cases from "./content-owner.cases.json";
import { contentOwner, contentOwnerInputFromSeed, type ContentOwnerCase } from "./content-owner";

const all = cases.cases as unknown as ContentOwnerCase[];

describe("contentOwner (casos compartidos con la función SQL)", () => {
  it.each(all.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(contentOwner(contentOwnerInputFromSeed(c.seed))).toBe(c.expected);
  });

  it("hay al menos 7 casos", () => {
    expect(all.length).toBeGreaterThanOrEqual(7);
  });
});

describe("contentOwner directo", () => {
  it("1) la pieza gana aunque no tenga responsable", () => {
    expect(contentOwner({ contentPost: { assigned_to: null }, publication: { assigned_to: "x" } })).toBeNull();
  });
  it("2) sin pieza, el de la publicación", () => {
    expect(contentOwner({ publication: { content_post: null, assigned_to: "x" } })).toBe("x");
  });
  it("3) sin nada, null", () => {
    expect(contentOwner({})).toBeNull();
    expect(contentOwner({ contentPost: null, publication: null })).toBeNull();
  });
});

describe("contentOwnerInputFromSeed", () => {
  it("una publicación vinculada sin pieza sembrada es un caso mal armado", () => {
    expect(() => contentOwnerInputFromSeed({ socialPost: { linkedToContentPost: true, assignedTo: null } })).toThrow();
  });
});
