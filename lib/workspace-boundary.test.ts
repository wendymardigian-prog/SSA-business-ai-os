/**
 * El workspace activo sale de UN solo lugar: `lib/workspace.ts`.
 *
 * Una persona puede ser miembro de dos negocios de la misma instalacion, y el
 * activo es el del selector (cookie `workspace_id`). Ocho API Routes tenian su
 * propia copia de "el primer workspace de la persona"
 * (`workspace_members ... .eq("user_id", ...).limit(1)`): estando en el
 * segundo negocio, el editor de automatizaciones guardaba en el primero.
 *
 * Este test falla si algun archivo de la app vuelve a buscar la membresia de
 * una persona con `.limit(1)` por su cuenta. La salida es `getWorkspace()` (pantallas
 * y Server Actions) o `getActiveWorkspace()` (API Routes, no redirige).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(__dirname, "..");
const SCAN_DIRS = ["lib", "app", "components"];
const ALLOWED = new Set(["lib/workspace.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/** Una consulta a `workspace_members` por usuario que se queda con una sola fila sin elegir cual. */
const FIRST_MEMBERSHIP = /\.from\(\s*["']workspace_members["']\s*\)(?:(?!\.from\()[\s\S]){0,400}?\.eq\(\s*["']user_id["'][\s\S]{0,200}?\.limit\(\s*1\s*\)/;

describe("el workspace activo sale de lib/workspace.ts", () => {
  it("ningun archivo busca 'el primer workspace' de una persona por su cuenta", () => {
    const offenders = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
      .map((f) => relative(ROOT, f))
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => FIRST_MEMBERSHIP.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("el patron atrapa la forma vieja", () => {
    const vieja = `await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();`;
    expect(FIRST_MEMBERSHIP.test(vieja)).toBe(true);
  });

  it("y no atrapa una consulta por workspace y usuario", () => {
    const buena = `await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", ws)
      .eq("user_id", user.id)
      .maybeSingle();`;
    expect(FIRST_MEMBERSHIP.test(buena)).toBe(false);
  });
});
