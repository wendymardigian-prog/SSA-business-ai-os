/**
 * El modulo que habla con Vault no puede terminar en el navegador.
 *
 * lib/vault.ts dice "solo desde el servidor" desde que se escribio, pero era un
 * comentario y nada lo hacia cumplir: la pantalla de integraciones importaba el
 * catalogo de proveedores, el catalogo importaba los nombres de los secretos de
 * lib/vault.ts, y asi el modulo de Vault viajaba en el bundle del cliente. Los
 * nombres no son secretos, pero el codigo que lee y escribe secretos no tiene
 * nada que hacer ahi.
 *
 * Este test sigue los imports de verdad desde cada archivo "use client" y falla
 * si alguno llega a lib/vault.ts. La cadena se corta en los archivos
 * "use server" (una Server Action que un cliente importa no se empaqueta: se
 * reemplaza por una llamada al servidor).
 *
 * No se usa `import "server-only"` porque ese paquete lanza al importarse en
 * Node, que es donde corren estos tests: pondria en verde el bundle y en rojo
 * la suite entera.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = resolve(__dirname, "..");
const SCAN_DIRS = ["lib", "app", "components"];
const EXTENSIONS = [".ts", ".tsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((e) => entry.endsWith(e)) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/** La directiva del archivo, si tiene una. */
function directiveOf(source: string): "use client" | "use server" | null {
  const head = source.slice(0, 400);
  const match = head.match(/^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["'](use client|use server)["']/);
  return (match?.[1] as "use client" | "use server" | undefined) ?? null;
}

/**
 * Los imports locales de un archivo, ya resueltos a una ruta de archivo.
 *
 * Los `import type` NO cuentan: TypeScript los borra al compilar, asi que el
 * modulo nunca viaja al navegador. Sin esta distincion el test marcaba 15
 * componentes que solo piden un tipo (por ejemplo `DraftActionResult`).
 */
function localImports(file: string, source: string): string[] {
  const specs = [...source.matchAll(/(?:^|[\n;])\s*(?:import|export)\s+(type\s+)?(?:[^'"()]*?\sfrom\s*)?["']([^"']+)["']/g)]
    .filter((m) => !m[1])
    .map((m) => m[2]);
  const resolved: string[] = [];
  for (const spec of specs) {
    let base: string | null = null;
    if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(file), spec);
    if (!base) continue;
    const candidates = [
      base,
      ...EXTENSIONS.map((e) => base + e),
      ...EXTENSIONS.map((e) => join(base, "index" + e)),
    ];
    const hit = candidates.find((c) => existsSync(c) && statSync(c).isFile());
    if (hit) resolved.push(hit);
  }
  return resolved;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const VAULT = join(ROOT, "lib/vault.ts");

/** El camino de imports desde un archivo hasta otro, si existe. */
function pathTo(entry: string, target: string): string[] | null {
  const seen = new Set<string>([entry]);
  const queue: Array<{ file: string; path: string[] }> = [{ file: entry, path: [entry] }];
  while (queue.length) {
    const { file, path } = queue.shift()!;
    for (const next of localImports(file, sources.get(file) ?? readFileSync(file, "utf8"))) {
      if (next === target) return [...path, next];
      if (seen.has(next)) continue;
      // Una Server Action corta la cadena: el cliente no la empaqueta.
      if (directiveOf(sources.get(next) ?? "") === "use server") continue;
      seen.add(next);
      queue.push({ file: next, path: [...path, next] });
    }
  }
  return null;
}

const pathToVault = (entry: string) => pathTo(entry, VAULT);

describe("limite del servidor: lib/vault.ts", () => {
  const clientFiles = files.filter((f) => directiveOf(sources.get(f) ?? "") === "use client");

  it("hay archivos de cliente para revisar (si no, el test no prueba nada)", () => {
    expect(clientFiles.length).toBeGreaterThan(10);
  });

  it("ningun Client Component llega a lib/vault.ts siguiendo imports", () => {
    const offenders = clientFiles
      .map((f) => ({ file: f, chain: pathToVault(f) }))
      .filter((r) => r.chain)
      .map((r) => r.chain!.map((f) => relative(ROOT, f)).join(" -> "));

    expect(offenders).toEqual([]);
  });

  it("la busqueda encuentra caminos que si existen (si no, el test seria vacio)", () => {
    // Un test que solo afirma "no encontre nada" pasa igual si la herramienta
    // esta rota. Este camino existe de verdad: la pantalla importa el catalogo.
    const screen = join(ROOT, "components/settings/integrations-view.tsx");
    const catalog = join(ROOT, "lib/integrations/providers.ts");
    expect(pathTo(screen, catalog)).not.toBeNull();
  });

  it("el catalogo de integraciones no depende del modulo de Vault", () => {
    // Es la cadena que fallaba: la pantalla importa el catalogo, y el catalogo
    // solo necesita los nombres.
    const catalog = join(ROOT, "lib/integrations/providers.ts");
    expect(localImports(catalog, sources.get(catalog)!).map((f) => relative(ROOT, f))).not.toContain(
      "lib/vault.ts",
    );
  });
});
