/**
 * Ventas 00164: `submit_form_response` v4 cambia SOLO lo del `sale_id` (plano F26b). Compara el
 * cuerpo de la función de la 00158 (la vigente antes) con el de la 00164 y falla si alguna línea
 * cambia fuera de lo permitido:
 *   - lo agregado tiene que ser un comentario, `END IF;` o una línea que nombre la venta;
 *   - lo quitado solo puede ser la línea del payload del evento (a la que se le suma `'sale_id'`).
 * También fija que la firma (los 8 parámetros) y los permisos no cambian.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");

function functionBody(sql: string): string[] {
  const lines = sql.split("\n");
  const start = lines.findIndex((l) => l.startsWith("CREATE OR REPLACE FUNCTION public.submit_form_response"));
  const end = lines.findIndex((l, i) => i > start && l.trim() === "$$;");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1).map((l) => l.trim()).filter((l) => l !== "");
}

/** Diff por subsecuencia común más larga: devuelve lo quitado y lo agregado. */
function diff(before: string[], after: string[]): { removed: string[]; added: string[] } {
  const n = before.length, m = after.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const removed: string[] = [], added: string[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) { i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) removed.push(before[i++]);
    else added.push(after[j++]);
  }
  while (i < n) removed.push(before[i++]);
  while (j < m) added.push(after[j++]);
  return { removed, added };
}

describe("submit_form_response v4 (00164) vs la vigente (00158)", () => {
  const before = functionBody(read("00158_forms_once_key_fix.sql"));
  const after = functionBody(read("00164_submit_form_response_sale.sql"));
  const { removed, added } = diff(before, after);

  it("lo agregado es un comentario, un END IF o una línea del sale_id", () => {
    const stray = added.filter((l) => !(l.startsWith("--") || l === "END IF;" || /sale/i.test(l)));
    expect(stray).toEqual([]);
    expect(added.some((l) => l.includes("sale_id_discarded"))).toBe(true);
  });

  it("lo único que se quita es la línea del payload, que gana 'sale_id'", () => {
    expect(removed).toEqual(["'score', v_score, 'nps_category', v_nps"]);
    expect(added).toContain("'score', v_score, 'nps_category', v_nps, 'sale_id', v_sale");
  });

  it("la firma y los permisos siguen iguales", () => {
    const text = read("00164_submit_form_response_sale.sql");
    expect(text).toContain("REVOKE ALL ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;");
    expect(text).toContain("GRANT EXECUTE ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;");
    expect(after.slice(0, 9)).toEqual(before.slice(0, 9));
  });

  it("la cabecera guarda la definición anterior para volver atrás", () => {
    expect(read("00164_submit_form_response_sale.sql")).toContain("9d28625fbbe3faabd5e438a26d445788");
    expect(read("00164_submit_form_response_sale.sql")).toContain("--   CREATE OR REPLACE FUNCTION public.submit_form_response(");
  });
});
