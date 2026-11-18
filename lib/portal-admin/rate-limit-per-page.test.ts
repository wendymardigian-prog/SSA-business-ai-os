// @plantilla-quitar(servicios)
/**
 * 00403: el tope de 60 por minuto por sesión del portal cuenta PANTALLAS (portal_context), no llamadas.
 * Mira la ÚLTIMA definición de cada función en las migraciones (la que queda en la base) y fija el diff
 * de la 00403 contra las definiciones que reemplaza.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => /^\d{5}_.*\.sql$/.test(f)).sort();

/** Cada definición `CREATE OR REPLACE FUNCTION <name>(` de un archivo, hasta su `$$;` / `$function$;`. */
function definitionsIn(file: string, name: string): string[] {
  const text = readFileSync(join(DIR, file), "utf8");
  const out: string[] = [];
  const head = new RegExp(`^CREATE OR REPLACE FUNCTION ${name.replace(".", "\\.")}\\(`, "gm");
  for (const m of text.matchAll(head)) {
    const rest = text.slice(m.index);
    const end = rest.search(/^\$(function)?\$;\s*$/m);
    out.push(rest.slice(0, end === -1 ? undefined : end));
  }
  return out;
}

function latest(name: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const f of FILES) for (const body of definitionsIn(f, name)) found = { file: f, body };
  if (!found) throw new Error(`no encontré ${name}`);
  return found;
}

function only(file: string, name: string): string {
  const defs = definitionsIn(file, name);
  expect(defs, `${name} en ${file}`).toHaveLength(1);
  return defs[0];
}

const lines = (s: string) => s.split("\n");
/** Las líneas de `a` que no están en `b`, contando repeticiones (un `END IF;` de menos cuenta). */
function minus(a: string, b: string): string[] {
  const left = new Map<string, number>();
  for (const l of lines(b)) left.set(l, (left.get(l) ?? 0) + 1);
  return lines(a).filter((l) => {
    const n = left.get(l) ?? 0;
    if (n > 0) left.set(l, n - 1);
    return n === 0;
  });
}
const removed = (before: string, after: string) => minus(before, after);
const added = (before: string, after: string) => minus(after, before);

describe("00403 · el tope del portal cuenta pantallas", () => {
  it("session_resolve ya no suma el tope por sesión", () => {
    const { file, body } = latest("app_servicio_portal.session_resolve");
    expect(file).toBe("00403_portal_rate_limit_per_page.sql");
    expect(body).not.toContain("bump_rate_limit");
    // El resto de la validación sigue igual.
    expect(body).toContain("'PO401'");
    expect(body).toContain("'PO402'");
    expect(body).toContain("portal_touch_active_day");
  });

  it("solo portal_context suma la clave portal-s: (60 por minuto)", () => {
    const { body } = latest("app_servicio_portal.portal_context");
    expect(body.match(/bump_rate_limit\('portal-s:'/g)).toHaveLength(1);
    expect(body).toContain("date_trunc('minute', now())) > 60");
    // La sesión se valida antes del tope (PO401/PO402 antes que PO429).
    expect(body.indexOf("session_resolve(p_session, false)")).toBeLessThan(body.indexOf("bump_rate_limit"));
    expect(body.indexOf("bump_rate_limit")).toBeLessThan(body.indexOf("ctx_context_base("));

    // Ninguna otra función del portal, en su última definición, suma esa clave.
    const names = new Set<string>();
    for (const f of FILES) {
      for (const m of readFileSync(join(DIR, f), "utf8").matchAll(/^CREATE OR REPLACE FUNCTION (app_servicio_portal\.\w+)\(/gm)) names.add(m[1]);
    }
    const others = [...names].filter((n) => n !== "app_servicio_portal.portal_context" && latest(n).body.includes("'portal-s:'"));
    expect(others).toEqual([]);
  });

  it("los topes de entrar no cambian", () => {
    expect(latest("app_servicio.portal_login_code_issue").body).toContain("date_trunc('hour', now())) > 5");
    expect(latest("app_servicio_portal.portal_login_password").body).toContain("date_trunc('hour', now())) > 10");
    expect(latest("app_servicio_portal.portal_login_verify").body).toContain("login_code_attempts >= 5");
  });

  it("session_resolve es la de la 00393 sin las tres líneas del tope", () => {
    const before = only("00393_portal_community_info.sql", "app_servicio_portal.session_resolve");
    const after = only("00403_portal_rate_limit_per_page.sql", "app_servicio_portal.session_resolve");
    expect(removed(before, after).map((l) => l.trim())).toEqual([
      "IF public.bump_rate_limit('portal-s:' || s.id::text, date_trunc('minute', now())) > 60 THEN",
      "PERFORM app_servicio_portal.err('PO429', 'Esperá unos minutos y volvé a probar');",
      "END IF;",
    ]);
    expect(added(before, after).every((l) => l.trim().startsWith("--"))).toBe(true);
  });

  it("portal_context es la de la 00397 con el tope al principio", () => {
    const before = only("00397_portal_projects.sql", "app_servicio_portal.portal_context");
    const after = only("00403_portal_rate_limit_per_page.sql", "app_servicio_portal.portal_context");
    expect(removed(before, after).map((l) => l.trim())).toEqual([
      "r jsonb := app_servicio_portal.ctx_context_base(p_session, p_host, p_product_id);",
      "sess jsonb;",
      "sess := app_servicio_portal.session_resolve(p_session, false);",
    ]);
  });

  it("portal_points es la de la 00402 con semana, mes y my_places (solo se agregan claves)", () => {
    const before = only("00402_community_by_variant.sql", "app_servicio_portal.portal_points");
    const after = only("00403_portal_rate_limit_per_page.sql", "app_servicio_portal.portal_points");
    const gone = removed(before, after);
    expect(gone).toHaveLength(1);
    expect(gone[0]).toContain("'by_group', r.by_group)");
    const now = added(before, after).join("\n");
    expect(now).toContain("'by_group', r.by_group, 'week', r.week_points, 'month', r.month_points)");
    expect(now).toContain("AS week_points");
    expect(now).toContain("AS month_points");
    expect(now).toContain("'my_places'");
  });
});
