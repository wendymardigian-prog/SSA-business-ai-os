import { describe, expect, it } from "vitest";
import {
  MAX_MENTIONS,
  activeMentionQuery,
  commentBodyProblem,
  filterCandidates,
  insertMention,
  mentionToken,
  mentionsInBody,
} from "./mentions";

const ana = { id: "u-ana", name: "Ana Pérez" };
const beto = { id: "u-beto", name: "Beto" };

describe("mentionsInBody", () => {
  it("deja solo las personas cuyo @Nombre sigue en el texto", () => {
    expect(mentionsInBody("Hola @Ana Pérez, mirá esto", [ana, beto])).toEqual(["u-ana"]);
  });
  it("no repite y nunca menciona a quien escribe", () => {
    expect(mentionsInBody("@Beto @Beto @Ana Pérez", [beto, beto, ana], "u-ana")).toEqual(["u-beto"]);
  });
  it("respeta el tope de menciones", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, name: `P${i}x` }));
    const body = many.map((c) => mentionToken(c.name)).join(" ");
    expect(mentionsInBody(body, many)).toHaveLength(MAX_MENTIONS);
  });
});

describe("activeMentionQuery", () => {
  it("abre la lista después de un @ al principio o tras un espacio", () => {
    expect(activeMentionQuery("@an", 3)).toEqual({ query: "an", start: 0 });
    expect(activeMentionQuery("hola @be", 8)).toEqual({ query: "be", start: 5 });
  });
  it("no la abre en un email ni si se cortó la línea", () => {
    expect(activeMentionQuery("ana@mail", 8)).toBeNull();
    expect(activeMentionQuery("@ana\nhola", 9)).toBeNull();
    expect(activeMentionQuery("sin arroba", 5)).toBeNull();
  });
});

describe("filterCandidates e insertMention", () => {
  it("filtra sin acentos ni mayúsculas, por nombre o apellido, sin uno mismo", () => {
    expect(filterCandidates([ana, beto], "pere")).toEqual([ana]);
    expect(filterCandidates([ana, beto], "", "u-beto")).toEqual([ana]);
  });
  it("reemplaza lo escrito desde el @ y deja el cursor después", () => {
    const r = insertMention("hola @an y más", 5, 8, ana);
    expect(r.text).toBe("hola @Ana Pérez  y más");
    expect(r.cursor).toBe(5 + "@Ana Pérez ".length);
  });
});

describe("commentBodyProblem", () => {
  it("pide texto y respeta el largo", () => {
    expect(commentBodyProblem("   ")).toMatch(/Escribí/);
    expect(commentBodyProblem("x".repeat(5001))).toMatch(/5000/);
    expect(commentBodyProblem("ok")).toBeNull();
  });
});
