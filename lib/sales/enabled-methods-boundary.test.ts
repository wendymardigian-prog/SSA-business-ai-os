/**
 * Test de frontera (Extra I, MP): `workspaces.enabled_payment_methods` quedó SIN LEERSE. Los métodos de
 * pago salen de `workspaces.payment_methods`. Si alguien vuelve a leer la columna vieja, ofrecería una
 * lista que ya no se edita.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["lib", "app", "components"];
const ALLOWED = new Set(["lib/types/database.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("enabled_payment_methods ya no se lee", () => {
  it("ningún archivo de la aplicación la menciona fuera de comentarios y de los tipos de la base", () => {
    const offenders = ROOTS.flatMap((root) => walk(root))
      .filter((file) => !ALLOWED.has(file.replace(/\\/g, "/")))
      .filter((file) => /enabled_payment_methods|enabledPaymentMethods/.test(stripComments(readFileSync(file, "utf8"))));
    expect(offenders).toEqual([]);
  });
});
