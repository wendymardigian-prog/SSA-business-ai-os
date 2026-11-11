import { describe, expect, it } from "vitest";
import { answersOf } from "./booking-detail-view";
import type { BookingField } from "./types";

const field = (over: Partial<BookingField> & Pick<BookingField, "identifier" | "type" | "label">): BookingField => ({
  id: over.identifier,
  system: false,
  visibility: "required",
  ...over,
});

describe("answersOf: las respuestas del formulario en el detalle", () => {
  const fields = [
    field({ identifier: "name", type: "name", label: "Nombre", system: true }),
    field({ identifier: "email", type: "email", label: "Email", system: true }),
    field({ identifier: "phone", type: "phone", label: "Teléfono", system: true }),
    field({ identifier: "whatsapp_otro", type: "phone", label: "Otro teléfono" }),
    field({ identifier: "rubro", type: "short_text", label: "¿A qué te dedicás?" }),
  ];

  it("marca el teléfono y el email por el TIPO de la pregunta, y dice si son los propios del invitado", () => {
    const out = answersOf({ name: "Ana", email: "a@x.com", phone: "+50686253206", whatsapp_otro: "+5491122334455", rubro: "Marketing" }, fields);
    expect(out).toEqual([
      { label: "Nombre", value: "Ana" },
      { label: "Email", value: "a@x.com", kind: "email", own: true },
      { label: "Teléfono", value: "+50686253206", kind: "phone", own: true },
      { label: "Otro teléfono", value: "+5491122334455", kind: "phone", own: false },
      { label: "¿A qué te dedicás?", value: "Marketing" },
    ]);
  });

  it("un texto que parece un teléfono pero es de otra pregunta no se marca", () => {
    const out = answersOf({ rubro: "+50686253206" }, fields);
    expect(out[0]).toEqual({ label: "¿A qué te dedicás?", value: "+50686253206" });
  });

  it("una clave que el evento ya no tiene se muestra tal cual, sin tipo", () => {
    expect(answersOf({ vieja: "dato" }, fields)).toEqual([{ label: "vieja", value: "dato" }]);
  });

  it("salta lo vacío y junta las listas", () => {
    expect(answersOf({ a: "", b: null, c: ["x", "y"] }, [])).toEqual([{ label: "c", value: "x, y" }]);
  });
});
