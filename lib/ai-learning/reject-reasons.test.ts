import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REJECT_REASONS, REJECT_REASON_LABELS, parseRejectInput } from "./reject-reasons";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/00441_ai_proposals_learning.sql"), "utf8");

describe("motivos de rechazo", () => {
  it("la lista de TypeScript es la misma que la de los dos CHECK de la base", () => {
    const lists = [...migration.matchAll(/reject_reason IN \(([^)]*)\)/g)].map((m) =>
      m[1].split(",").map((x) => x.trim().replace(/'/g, "")),
    );
    expect(lists.length).toBeGreaterThanOrEqual(2);
    for (const list of lists) expect(list).toEqual([...REJECT_REASONS]);
  });

  it("los motivos del texto, con su etiqueta", () => {
    expect(Object.values(REJECT_REASON_LABELS)).toEqual([
      "Tono",
      "Dato incorrecto",
      "No corresponde a este cliente",
      "Demasiado largo",
      "Falta información",
      "Otro (con nota)",
    ]);
  });

  it("«otro» exige nota; un motivo fuera de la lista no pasa; la nota tiene tope", () => {
    expect(parseRejectInput("other", "  ")).toMatchObject({ ok: false });
    expect(parseRejectInput("other", "No es el momento")).toEqual({ ok: true, reason: "other", note: "No es el momento" });
    expect(parseRejectInput("tone", "")).toEqual({ ok: true, reason: "tone", note: null });
    expect(parseRejectInput("aburrido", null)).toMatchObject({ ok: false });
    expect(parseRejectInput("tone", "x".repeat(501))).toMatchObject({ ok: false });
  });
});
