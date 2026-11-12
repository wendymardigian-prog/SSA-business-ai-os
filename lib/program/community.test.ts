// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./community.cases.json";
import { canPost, communityQuickOptions, communityQuickValue, DEFAULT_SPACES, lessonCommentsOn, programSpaces, spaceKeyFor, spacesIssues, type CanPostInput } from "./community";

describe("canPost: casos compartidos con la base", () => {
  it.each(cases.cases.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    expect(canPost(c.input as CanPostInput)).toEqual(c.expected);
  });
});

describe("espacios", () => {
  it("sin configurar, los de fábrica; «clases» nunca es un espacio del muro", () => {
    expect(programSpaces({})).toEqual(DEFAULT_SPACES);
    expect(programSpaces({ community: { spaces: [{ key: "clases", name: "Clases" }, { key: "general", name: "General" }] } }).map((s) => s.key)).toEqual(["general"]);
    expect(DEFAULT_SPACES.find((s) => s.key === "anuncios")?.team_only).toBe(true);
  });
  it("los comentarios de las clases nacen prendidos", () => {
    expect(lessonCommentsOn({})).toBe(true);
    expect(lessonCommentsOn({ community: { lesson_comments: false } })).toBe(false);
  });
  it("spacesIssues", () => {
    expect(spacesIssues(DEFAULT_SPACES)).toEqual([]);
    expect(spacesIssues([{ key: "general", name: "" }])).toContain("Hay un espacio sin nombre");
    expect(spacesIssues([{ key: "clases", name: "Clases" }])).toContain("«clases» es el espacio de los comentarios de las clases");
    expect(spacesIssues([{ key: "a", name: "A", archived: true }])).toEqual(["Dejá al menos un espacio activo"]);
  });
  it("spaceKeyFor", () => {
    expect(spaceKeyFor("Preguntas técnicas", [])).toBe("preguntas_tecnicas");
    expect(spaceKeyFor("General", ["general"])).toBe("general_2");
    expect(spaceKeyFor("Clases", [])).toBe("clases_1");
  });
});


describe("Comunidad: el filtro rapido de la barra (Servicios A2)", () => {
  const spaces = [
    { key: "general", name: "General", team_only: false, archived: false },
    { key: "viejo", name: "Viejo", team_only: false, archived: true },
  ] as never;
  it("ofrece Todo, Sin contestar, Reportados, los espacios vivos y Clases, con su link", () => {
    const o = communityQuickOptions({ base: "/dashboard/portal/p1", spaces, counts: { unanswered: 3, reported: 1 } });
    expect(o.map((x) => x.key)).toEqual(["all", "unanswered", "reported", "esp:general", "esp:clases"]);
    expect(o[1]).toMatchObject({ count: 3, href: "/dashboard/portal/p1?tab=comunidad&filtro=sin-contestar" });
    expect(o[3].href).toBe("/dashboard/portal/p1?tab=comunidad&espacio=general");
  });
  it("un filtro gana sobre un espacio", () => {
    expect(communityQuickValue("unanswered", "general")).toBe("unanswered");
    expect(communityQuickValue("all", "general")).toBe("esp:general");
    expect(communityQuickValue("all", null)).toBe("all");
  });
});
