import { describe, it, expect } from "vitest";
import { describeConflicts, describeContactNotes, matchedByText } from "./contact-outcome";

describe("describeConflicts", () => {
  it("nombra el dato que coincide con otro contacto", () => {
    const conflicts = describeConflicts({ matched_by: "phone", conflict_contact_id: "b", conflicts: [{ by: "instagram", contact_id: "b" }] });
    expect(conflicts).toEqual([{ by: "instagram", contactId: "b", text: "El @ de Instagram coincide con otro contacto" }]);
  });

  it("una respuesta vieja (solo conflict_contact_id) se lee como un conflicto por email", () => {
    expect(describeConflicts({ matched_by: "phone", conflict_contact_id: "b" })).toEqual([{ by: "email", contactId: "b", text: "El email coincide con otro contacto" }]);
  });

  it("sin conflictos, nada; y lo mal formado se ignora", () => {
    expect(describeConflicts({ matched_by: "email" })).toEqual([]);
    expect(describeConflicts(null)).toEqual([]);
    expect(describeConflicts({ conflicts: [{ by: 3, contact_id: null }] })).toEqual([]);
  });

  it("no repite el mismo par", () => {
    const c = describeConflicts({ conflicts: [{ by: "email", contact_id: "b" }, { by: "email", contact_id: "b" }] });
    expect(c).toHaveLength(1);
  });
});

describe("matchedByText", () => {
  it("dice por qué dato se vinculó", () => {
    expect(matchedByText("instagram")).toBe("La respuesta se vinculó por el usuario de Instagram.");
    expect(matchedByText(null)).toBeNull();
  });
});

describe("describeContactNotes", () => {
  it("convierte las notas en frases", () => {
    expect(
      describeContactNotes({
        contact_notes: [
          { reason: "country_unrecognized", text: "Narnia" },
          { reason: "social_invalid", text: "ana perez", platform: "tiktok" },
        ],
      }),
    ).toEqual(["País no reconocido: Narnia", "Usuario de TikTok no válido: ana perez"]);
  });

  it("ignora lo que no tiene la forma esperada", () => {
    expect(describeContactNotes({ contact_notes: [null, { reason: "otra", text: "x" }, { reason: "country_unrecognized" }] })).toEqual([]);
    expect(describeContactNotes({})).toEqual([]);
  });
});
