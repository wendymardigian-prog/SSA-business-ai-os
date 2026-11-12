// @plantilla-quitar(servicios)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F122 (decision 463): en el modulo nada se elige escribiendo una clave o un id. Recorre las pantallas y los paneles de
 * Servicios y falla si aparece un campo de texto que pida una clave (`ph_…`, `it_…`) o un id.
 */
const root = resolve(__dirname, "../..");
const DIRS = [
  "components/services",
  "components/affiliates",
  "app/(dashboard)/dashboard/clientes",
  "app/(dashboard)/dashboard/portal",
  "app/(dashboard)/dashboard/afiliados",
];
const FILES = ["components/flow-builder/panels/ServiceActionPanel.tsx", "components/flow-builder/panels/ServiceTriggerPanel.tsx"];

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(join(root, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith(".tsx")) out.push(rel);
  }
}

const TYPED_KEY = [/placeholder="[^"]*\b(clave|id del|uuid)\b[^"]*"/i, /placeholder="(ph|it)_/i, /placeholder="Clave de/i];

describe("ningún campo del módulo pide escribir una clave o un id", () => {
  const files = [...FILES];
  for (const d of DIRS) walk(d, files);
  it("recorre las pantallas y los paneles", () => expect(files.length).toBeGreaterThan(20));
  for (const f of files) {
    it(f, () => {
      const src = readFileSync(join(root, f), "utf8");
      for (const re of TYPED_KEY) expect(src, `${f}: ${re}`).not.toMatch(re);
    });
  }
});
