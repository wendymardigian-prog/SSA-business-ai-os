/**
 * La frontera de los modulos de la plantilla de estudiantes.
 *
 * Simula lo que hace el export: borra las rutas de los modulos excluidos (perfiles/estudiantes.mjs) y saca
 * lo marcado en cada archivo que se queda (markers.mjs). Despues falla si:
 *
 *   - un archivo que se queda importa (estatico, dinamico, `vi.mock`, `require` o `export ... from`) algo
 *     que se borra, o un paquete que es solo de un modulo excluido;
 *   - una marca nombra un modulo que no existe, o un bloque no cierra / se anida;
 *   - una ruta del perfil no existe (un perfil viejo no puede pasar por bueno).
 *
 * Los tests tambien cuentan: un test que se queda y usa un modulo tiene que estar marcado o listado en
 * `excludeTests` del perfil. La prueba de que compila sin los modulos es `simulate-export.mjs` (tsc sobre la copia).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { stripMarkers, hasMarkers } from "./markers.mjs";
import { EXCLUDED, MODULES, PACKAGES, excludeTests, isExcludedPath, isToolingPath } from "./perfiles/estudiantes.mjs";

const ROOT = resolve(__dirname, "..", "..");
const KNOWN = Object.keys(MODULES);
const ROOTS = ["app", "lib", "components", "scripts", "middleware.ts"];
const SOURCE = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".claude", "docs"]);

function walk(rel: string, out: string[]): void {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return;
  if (statSync(abs).isFile()) {
    if (SOURCE.test(rel)) out.push(rel);
    return;
  }
  for (const name of readdirSync(abs)) {
    if (SKIP_DIRS.has(name)) continue;
    walk(`${rel}/${name}`, out);
  }
}

/** Los archivos que viajan a la plantilla (los de codigo). */
function keptFiles(): string[] {
  const all: string[] = [];
  for (const r of ROOTS) walk(r, all);
  return all.filter((f) => !isToolingPath(f) && !isExcludedPath(f));
}

/** Lo que importa un archivo: cada especificador con su linea. */
function importsOf(text: string): Array<{ spec: string; line: number }> {
  const out: Array<{ spec: string; line: number }> = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\sfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bvi\.(?:mock|doMock|importActual)\s*\(\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split("\n").length;
      out.push({ spec: m[1], line });
    }
  }
  return out;
}

const EXTS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", "/index.ts", "/index.tsx", "/index.mjs", "/index.js"];

/** A que archivo del repo apunta un especificador (relativo a la raiz), o null si es un paquete. */
function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = relative(ROOT, resolve(ROOT, dirname(from), spec));
  else return null;
  base = base.replace(/\\/g, "/");
  for (const ext of EXTS) {
    const candidate = base + ext;
    const abs = join(ROOT, candidate);
    if (existsSync(abs) && statSync(abs).isFile()) return candidate;
  }
  // No existe: igual se devuelve (si cae en una ruta borrada, cuenta).
  return base;
}

/** El paquete de un especificador ("@scope/pkg/x" -> "@scope/pkg"), o null si es del repo. */
function packageOf(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

describe("perfil de la plantilla de estudiantes", () => {
  it("cada ruta del perfil existe (un perfil viejo falla)", () => {
    const missing: string[] = [];
    for (const [id, mod] of Object.entries(MODULES)) {
      for (const p of mod.paths) if (!existsSync(join(ROOT, p))) missing.push(`${id}: ${p}`);
      const replacements = (mod as { replacements?: Record<string, string> }).replacements ?? {};
      for (const src of Object.values(replacements)) if (!existsSync(join(ROOT, src))) missing.push(`${id}: reemplazo ${src}`);
    }
    for (const t of excludeTests) {
      if (!existsSync(join(ROOT, t.path))) missing.push(`excludeTests: ${t.path}`);
      for (const m of t.modules) if (!KNOWN.includes(m)) missing.push(`excludeTests: ${t.path} nombra el modulo desconocido "${m}"`);
    }
    for (const [pkg, mods] of Object.entries(PACKAGES)) for (const m of mods) if (!KNOWN.includes(m)) missing.push(`PACKAGES: ${pkg} nombra "${m}"`);
    expect(missing).toEqual([]);
  });

  it("los paquetes de un modulo existen en package.json", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(PACKAGES).filter((name) => !(name in deps))).toEqual([]);
  });
});

describe("frontera de los modulos excluidos", () => {
  const files = keptFiles();
  const problems: string[] = [];
  const markerErrors: string[] = [];
  const excludedPackages = new Set(Object.entries(PACKAGES).filter(([, mods]) => mods.some((m) => EXCLUDED.includes(m))).map(([name]) => name));

  for (const file of files) {
    const raw = readFileSync(join(ROOT, file), "utf8");
    let text = raw;
    if (hasMarkers(raw)) {
      try {
        text = stripMarkers(raw, EXCLUDED, KNOWN);
      } catch (error) {
        markerErrors.push(`${file}: ${(error as Error).message}`);
        continue;
      }
    }
    for (const { spec, line } of importsOf(text)) {
      const pkg = packageOf(spec);
      if (pkg) {
        if (excludedPackages.has(pkg)) problems.push(`${file}:${line} usa el paquete ${pkg}, que es solo de un modulo excluido`);
        continue;
      }
      const target = resolveSpec(file, spec);
      if (target && isExcludedPath(target)) problems.push(`${file}:${line} importa ${spec} (es de un modulo excluido)`);
    }
  }

  it("encuentra los archivos que se quedan", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("las marcas estan bien escritas y nombran modulos que existen", () => {
    expect(markerErrors).toEqual([]);
  });

  it("sacando lo marcado, ningun archivo que se queda importa algo que se va", () => {
    expect(problems).toEqual([]);
  });
});
