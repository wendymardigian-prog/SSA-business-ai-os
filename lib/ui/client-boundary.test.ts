import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Una pagina o un layout (codigo del servidor) puede DIBUJAR un componente de un archivo `"use client"`, pero no
 * LLAMAR una funcion de ahi: React la reemplaza por una referencia y la pagina se cae entera ("Attempted to call X()
 * from the server"). Ni el typecheck ni el build lo ven; se ve recien al abrir la pantalla. Paso con `intentHref` en
 * la pagina de un programa (Servicios A2). Este test sigue los imports de cada pagina y falla si trae algo que no es
 * un componente (nombre en minuscula) de un archivo de cliente.
 */
const root = resolve(__dirname, "../..");

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(join(root, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/(^|\/)(page|layout)\.tsx$/.test(rel)) out.push(rel);
  }
}

function resolveImport(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = join(root, spec.slice(2));
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(cand)) return cand;
  return null;
}

const isClient = (src: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src);

describe("ninguna página llama una función de un archivo de cliente", () => {
  const pages: string[] = [];
  walk("app", pages);
  it("recorre las páginas", () => expect(pages.length).toBeGreaterThan(50));
  for (const page of pages) {
    const src = readFileSync(join(root, page), "utf8");
    if (isClient(src)) continue;
    it(page, () => {
      const bad: string[] = [];
      for (const m of src.matchAll(/import\s+(?!type\b)\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)) {
        const file = resolveImport(m[2]);
        if (!file || !isClient(readFileSync(file, "utf8"))) continue;
        for (const raw of m[1].split(",")) {
          const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
          if (!name || raw.trim().startsWith("type ")) continue;
          if (/^[a-z]/.test(name)) bad.push(`${name} (de ${m[2]})`);
        }
      }
      expect(bad, `${page} importa funciones de un archivo "use client"`).toEqual([]);
    });
  }
});
