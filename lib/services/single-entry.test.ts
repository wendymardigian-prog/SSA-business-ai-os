// @plantilla-quitar(servicios)
/**
 * `app_servicio.svc_create_service` es la UNICA entrada a `services` (F8, §9c-1) y `progress_pct` lo
 * calcula la base (F23, §9c-6). Estos tests recorren el codigo y las migraciones y fallan si aparece otra
 * forma de crear un servicio o un componente que calcula el avance por su cuenta.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|sql)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const CODE = ["app", "lib", "components", "scripts"].flatMap((d) => walk(join(ROOT, d)));
const MIGRATIONS = walk(join(ROOT, "supabase", "migrations")).filter((p) => !p.endsWith("ALL_MIGRATIONS.sql"));

describe("una sola entrada a services", () => {
  it("ningun archivo de la app inserta en services", () => {
    // Los verify-* intentan escribir A PROPOSITO para comprobar que la base lo rechaza (mismo criterio que
    // lib/contacts/single-entry.test.ts con los contactos de prueba).
    const offenders = CODE.filter((p) => !/[\\/]scripts[\\/]verify-[^\\/]+\.mjs$/.test(p)).filter((p) => {
      const src = readFileSync(p, "utf8");
      return /from\(\s*["']services["']\s*\)\s*\.(insert|upsert)/.test(src);
    });
    expect(offenders.map((p) => p.replace(ROOT, ""))).toEqual([]);
  });

  it("en las migraciones, solo svc_create_service inserta en app_servicio.services", () => {
    const offenders: string[] = [];
    for (const p of MIGRATIONS) {
      const src = readFileSync(p, "utf8").replace(/--.*$/gm, "");
      const re = /INSERT\s+INTO\s+app_servicio\.services\s*\(/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const before = src.slice(0, m.index);
        const fn = [...before.matchAll(/CREATE OR REPLACE FUNCTION\s+([\w.]+)\s*\(/gi)].pop()?.[1] ?? "(fuera de una funcion)";
        if (fn !== "app_servicio.svc_create_service") offenders.push(`${p.replace(ROOT, "")}: ${fn}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("un solo numero de avance (F23)", () => {
  it("ningun componente calcula el avance de un servicio: se lee progress_pct", () => {
    const offenders = walk(join(ROOT, "components"))
      .concat(walk(join(ROOT, "app")))
      .filter((p) => {
        const src = readFileSync(p, "utf8");
        return /service_items/.test(src) && /(completed|done)\s*\/\s*(total|required)/i.test(src);
      });
    expect(offenders.map((p) => p.replace(ROOT, ""))).toEqual([]);
  });
});
