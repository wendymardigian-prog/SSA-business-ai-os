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

/**
 * Los modulos que NUNCA pueden llegar al navegador.
 *
 * Vault es el original. `lib/supabase/server.ts` se sumo despues de tropezar
 * con lo mismo por otro lado: la bandeja importo una constante de
 * `lib/email/inbound.ts`, ese modulo importa el procesamiento del correo, y
 * con el se vino `next/headers`. El build fallo, que esta bien, pero falla
 * con un error de Turbopack sobre un archivo que no se toco — y eso cuesta
 * media hora de entender.
 *
 * Con este test el mismo error sale nombrando la cadena entera.
 */
const SERVER_ONLY = [
  { label: "lib/vault.ts", file: VAULT },
  { label: "lib/supabase/server.ts", file: join(ROOT, "lib/supabase/server.ts") },
];

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
    const screen = join(ROOT, "components/settings/integrations/integrations-grid.tsx");
    const catalog = join(ROOT, "lib/integrations/providers.ts");
    expect(pathTo(screen, catalog)).not.toBeNull();
  });

  it("ningun Client Component llega al cliente de servidor de Supabase", () => {
    // Ese modulo importa `next/headers`, que no existe en el navegador. El
    // build lo detecta, pero senalando un archivo que nadie toco; esto lo
    // detecta nombrando la cadena.
    const server = join(ROOT, "lib/supabase/server.ts");

    const offenders = clientFiles
      .map((f) => ({ file: f, chain: pathTo(f, server) }))
      .filter((r) => r.chain)
      .map((r) => r.chain!.map((f) => relative(ROOT, f)).join(" -> "));

    expect(offenders).toEqual([]);
  });

  it("la lista de modulos prohibidos existe y apunta a archivos reales", () => {
    for (const entry of SERVER_ONLY) {
      expect(existsSync(entry.file), entry.label).toBe(true);
    }
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
