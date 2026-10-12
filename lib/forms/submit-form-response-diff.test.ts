/**
 * Formularios 00176: `submit_form_response` v5 cambia SOLO lo del modo "none" (R3) y lo de los usuarios de redes
 * sociales (R5d). Compara el cuerpo de la v4 (00164, la vigente antes) con el de la 00176 y falla si cambia
 * alguna línea fuera de lo permitido. Mismo método que lib/sales/submit-form-response-diff.test.ts.
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

describe("submit_form_response v5 (00176) vs la vigente (00164)", () => {
  const sql = read("00176_submit_form_response_v5.sql");
  const before = functionBody(read("00164_submit_form_response_sale.sql"));
  const after = functionBody(sql);
  const { removed, added } = diff(before, after);

  it("lo único que se quita es la búsqueda del contacto, el alta y el dedupe", () => {
    expect(removed).toEqual([
      "ELSIF v_phone IS NOT NULL OR v_wa IS NOT NULL OR v_email IS NOT NULL THEN",
      "PERFORM pg_advisory_xact_lock(hashtextextended('form-contact:' || v_form.workspace_id::text || ':' || COALESCE(v_phone, v_wa, v_email), 0));",
      "v_found := public.find_contact_by_phone_or_email(v_form.workspace_id, COALESCE(v_phone, v_wa), v_email);",
      "v_found := public.find_contact_by_phone_or_email(v_form.workspace_id, v_wa, v_email);",
      "IF v_mode = 'create_or_link' AND (v_email IS NOT NULL OR v_phone IS NOT NULL OR v_wa IS NOT NULL) THEN",
      "(workspace_id, display_name, email, phone, whatsapp_phone, country, attribution, last_interaction_at)",
      "v_form.workspace_id, v_name, v_email, v_phone, v_wa, v_country,",
      "jsonb_build_object('matched_by', v_matched, 'conflict_contact_id', v_conflict),",
    ]);
  });

  it("lo agregado es un comentario, estructura o una línea del modo none / las redes sociales", () => {
    const allowed = /^(--|END IF;$|END LOOP;$|LOOP$|ELSE\b|\)$|\]\)|WHEN\b|THEN\b|AND\b|OR\b|FROM\b|WHERE\b|JOIN\b|SELECT\b)|v_(ig|tt|x|li|fb|yt|social|conflicts|lock_key|has_ident|mode|name|email|phone|wa|country|hint|found|contact|conflict|matched|overwrite)\b|instagram|tiktok|twitter|linkedin|facebook|youtube|contact_channels|find_contact_for_form|'phone:'|\|\| CASE WHEN jsonb_array_length|'conflicts'/;
    // Las tres líneas del INSERT de contactos que se reacomodan para sumar las columnas de redes.
    const reshaped = ["(workspace_id, display_name, email, phone, whatsapp_phone, country,", "attribution, last_interaction_at)", "v_form.workspace_id,"];
    const stray = added.filter((l) => !allowed.test(l) && !reshaped.includes(l));
    expect(stray).toEqual([]);
  });

  it("no toca la validación del sale_id, la firma del contrato, el evento ni 'una vez por contacto'", () => {
    const touched = [...removed, ...added].filter((l) => /sale|record_contract_signature|contract_text|oncePerContact|once_key|automation_events|audit_log|score|nps/i.test(l));
    expect(touched).toEqual([]);
  });

  it("el modo none descarta el hint ANTES de leer el link firmado", () => {
    const none = sql.indexOf("IF v_mode = 'none' THEN");
    const signed = sql.indexOf("signed_contact_id", none);
    expect(none).toBeGreaterThan(-1);
    expect(signed).toBeGreaterThan(none);
    expect(sql).toContain("v_hint := '{}'::jsonb;");
  });

  it("instagram_username no se pisa si el contacto tiene un canal de Instagram vinculado", () => {
    expect(sql).toMatch(/contact_channels cc JOIN public\.channels ch ON ch\.id = cc\.channel_id/);
    expect(sql).toContain("ch.platform = 'instagram'");
    // La excepción va ANTES de la rama overwrite.
    const channel = sql.indexOf("ch.platform = 'instagram'");
    const overwrite = sql.indexOf("WHEN v_overwrite THEN COALESCE(v_ig, c.instagram_username)");
    expect(channel).toBeGreaterThan(-1);
    expect(overwrite).toBeGreaterThan(channel);
  });

  it("la firma y los permisos siguen iguales", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;");
    expect(after.slice(0, 9)).toEqual(before.slice(0, 9));
  });

  it("la cabecera guarda la definición anterior para volver atrás", () => {
    expect(sql).toContain("bbaaaa563adedf837337d95a8691515d");
    expect(sql).toContain("--   CREATE OR REPLACE FUNCTION public.submit_form_response(");
  });
});

describe("find_contact_for_form (00175)", () => {
  const sql = read("00175_find_contact_for_form.sql");

  it("busca en el orden teléfono, email, Instagram, TikTok, X, LinkedIn", () => {
    const order = ["'by', 'phone'", "'by', 'email'", "'by', 'instagram'", "'by', 'tiktok'", "'by', 'x'", "'by', 'linkedin'"].map((s) => sql.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("solo contactos vivos, el más antiguo gana, y no se usa Facebook ni YouTube para buscar", () => {
    expect(sql.match(/c\.deleted_at IS NULL/g)?.length).toBeGreaterThanOrEqual(6);
    expect(sql.match(/ORDER BY c\.created_at ASC LIMIT 1/g)?.length).toBe(6);
    expect(sql).not.toMatch(/facebook_id\s*=/);
    expect(sql).not.toMatch(/youtube_channel_id\s*=/);
  });

  it("solo la ejecuta el servidor, y no modifica find_contact_by_phone_or_email", () => {
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.find_contact_for_form(uuid, text, text, jsonb) TO service_role;");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.find_contact_by_phone_or_email/);
  });
});
