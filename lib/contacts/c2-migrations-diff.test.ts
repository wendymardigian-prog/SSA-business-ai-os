/**
 * Contactos: regla unica (C2). Las migraciones 00202, 00203 y 00204 reescriben tres funciones vivas
 * (`find_or_link_contact`, `create_booking`, `submit_form_response`). Cada una trae en su cabecera la
 * definicion VIEJA completa (para volver atras) y como cuerpo la nueva. Este test las compara linea por
 * linea y fija EXACTAMENTE que se quito y que se agrego (`c2-migrations-diff.snapshot.json`): si alguien toca
 * una linea de mas, el test lo dice. Mismo metodo que lib/forms/submit-form-response-diff.test.ts.
 *
 * Para regenerar el snapshot despues de un cambio deliberado: `UPDATE_C2_SNAPSHOT=1 npx vitest run <este archivo>`
 * y REVISAR el diff del JSON a mano.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";

const SNAPSHOT = "lib/contacts/c2-migrations-diff.snapshot.json";
const files = [
  { name: "00202_find_or_link_contact_v3.sql", fn: "find_or_link_contact" },
  { name: "00203_create_booking_v3.sql", fn: "create_booking" },
  { name: "00204_submit_form_response_v6.sql", fn: "submit_form_response" },
];

function parse(name: string): { before: string[]; after: string[] } {
  const lines = readFileSync(`supabase/migrations/${name}`, "utf8").split("\n");
  const marker = lines.findIndex((l) => l.startsWith("-- ==== "));
  expect(marker).toBeGreaterThan(-1);
  const before: string[] = [];
  for (let i = marker + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith("-- =====")) break;
    if (l.startsWith("--")) before.push(l.replace(/^-- ?/, "").trim());
  }
  const bodyStart = lines.findIndex((l) => l.startsWith("CREATE OR REPLACE FUNCTION public."));
  expect(bodyStart).toBeGreaterThan(-1);
  const after = lines.slice(bodyStart).map((l) => l.trim());
  return { before: before.filter(Boolean), after: after.filter(Boolean) };
}

/** Diff por subsecuencia comun mas larga. */
function diff(before: string[], after: string[]): { removed: string[]; added: string[] } {
  const n = before.length, m = after.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = before[i] === after[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const removed: string[] = [], added: string[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) { i++; j++; }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) removed.push(before[i++]!);
    else added.push(after[j++]!);
  }
  while (i < n) removed.push(before[i++]!);
  while (j < m) added.push(after[j++]!);
  return { removed, added };
}

const actual: Record<string, { removed: string[]; added: string[] }> = {};
for (const f of files) actual[f.name] = diff(...(Object.values(parse(f.name)) as [string[], string[]]));

if (process.env.UPDATE_C2_SNAPSHOT === "1") writeFileSync(SNAPSHOT, JSON.stringify(actual, null, 2) + "\n");

describe("C2: las funciones reescritas cambian SOLO lo planeado", () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as typeof actual;

  for (const f of files) {
    it(`${f.name}: el diff contra la definicion vieja es exactamente el aprobado`, () => {
      expect(actual[f.name]).toEqual(snapshot[f.name]);
    });
  }

  it("la firma de cada funcion no cambia", () => {
    for (const f of files) {
      const { before, after } = parse(f.name);
      expect(after[0]).toBe(before[0]);
    }
  });

  it("find_or_link_contact conserva el historial, las sugerencias y los valores de linked_by", () => {
    const { after } = parse("00202_find_or_link_contact_v3.sql");
    const text = after.join("\n");
    for (const keep of ["'linked_by', v_linked_by", "link_suggestions", "'contact_created'", "'source', 'inbound'", "is_placeholder_name", "avatar_source = 'external'"]) {
      expect(text).toContain(keep);
    }
    for (const value of ["'phone'", "'email'", "'username'", "'channel'"]) expect(text).toContain(value);
  });

  it("create_booking conserva la exclusion, el toque de atribucion y los jobs", () => {
    const text = parse("00203_create_booking_v3.sql").after.join("\n");
    for (const keep of ["IF p_origin NOT IN ('manual', 'agent') THEN", "PERFORM public.record_contact_touch(", "'booking_google_sync'", "'booking_ended'", "'booking_created'"]) {
      expect(text).toContain(keep);
    }
  });

  it("submit_form_response conserva el contrato, el modo none, la venta firmada y los eventos", () => {
    const text = parse("00204_submit_form_response_v6.sql").after.join("\n");
    for (const keep of ["v_mode = 'none'", "record_contract_signature", "sale_id_discarded", "'form_submitted'", "'survey_answered'", "'contract_signed'", "already_answered"]) {
      expect(text).toContain(keep);
    }
  });

  it("ninguna de las tres inserta en contacts por su cuenta", () => {
    for (const f of files) {
      const text = parse(f.name).after.join("\n");
      expect(text, f.name).not.toMatch(/insert\s+into\s+(public\.)?contacts\b/i);
    }
  });
});
