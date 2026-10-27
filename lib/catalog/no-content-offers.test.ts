/**
 * Después de la 00160 la tabla `content_offers` no la lee ni la escribe nadie:
 * la reemplaza `products`. Este test recorre el código de la aplicación y falla
 * si aparece una consulta a la tabla vieja. Los comentarios y las migraciones
 * (que tienen derecho a nombrarla) quedan afuera;
 *
 * La tabla se borró en la 00171 (12/10/2026), después de desplegar este código.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIRS = ["app", "lib", "components", "scripts"];
const EXTENSIONS = /\.(ts|tsx|mjs)$/;
const SKIP = new Set(["node_modules", ".next"]);
// verify-sales.mjs nombra la tabla vieja A PROPÓSITO: comprueba que ya no existe (00171).
// create-sale-variant-diff.test.ts lee la migración 00169, que reescribe el puente y por eso nombra la tabla.
const SKIP_FILES = new Set(["lib/catalog/no-content-offers.test.ts", "lib/sales/create-sale-variant-diff.test.ts", "scripts/verify-sales.mjs"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (EXTENSIONS.test(name)) out.push(full);
  }
  return out;
}

/** Saca los comentarios de bloque y de línea (lo suficiente para este chequeo). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
}

describe("nadie lee content_offers", () => {
  const files = DIRS.flatMap((d) => walk(join(ROOT, d))).filter((f) => !SKIP_FILES.has(f.slice(ROOT.length + 1)));

  it("recorre el código de la aplicación", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("ningún archivo consulta la tabla vieja", () => {
    const offenders = files
      .filter((f) => /content_offers/.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });
});
