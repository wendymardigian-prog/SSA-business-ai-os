// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { weeklyDigestView } from "./weeklyDigestView";

describe("weeklyDigestView (F252)", () => {
  it("un estudiante sin reto y sin proyectos: esas secciones no aparecen; referidos aparece siempre al final", () => {
    const r = weeklyDigestView([{ key: "done", text: "Viste 3 clases." }, { key: "challenge", text: null }, { key: "projects", text: "" }], "Compartí tu link.");
    expect(r.map((s) => s.key)).toEqual(["done", "referrals"]);
    expect(r.at(-1)).toEqual({ key: "referrals", title: "Mis referidos", text: "Compartí tu link." });
  });
  it("respeta el orden aunque los datos vengan desordenados", () => {
    const r = weeklyDigestView([{ key: "fame", text: "a" }, { key: "done", text: "b" }, { key: "referrals", text: "c" }], "x");
    expect(r.map((s) => s.key)).toEqual(["done", "fame", "referrals"]);
  });
});
