/**
 * G9: Channels salio del menu (Bloque N), pero la pantalla se conserva
 * entera y se llega desde el detalle de Zernio y de Evolution en
 * Integraciones (G6). Ningun link interno a /dashboard/channels debe
 * romperse.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
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

describe("links internos a /dashboard/channels", () => {
  it("la pantalla sigue existiendo, con su QR y su callback", () => {
    const base = join(ROOT, "app/(dashboard)/dashboard/channels");
    expect(existsSync(join(base, "page.tsx"))).toBe(true);
    expect(existsSync(join(base, "channels-view.tsx"))).toBe(true);
    expect(existsSync(join(base, "callback/page.tsx"))).toBe(true);
  });

  it("ninguna ruta citada hacia /dashboard/channels apunta a un page.tsx que no existe", () => {
    const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
    const rutasCitadas = new Set<string>();

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/["'`](\/dashboard\/channels(?:\/callback)?)[^"'`]*["'`]/g)) {
        rutasCitadas.add(match[1]);
      }
    }

    expect(rutasCitadas.size).toBeGreaterThan(0);

    const base = join(ROOT, "app/(dashboard)/dashboard/channels");
    const rotas = [...rutasCitadas].filter((ruta) => {
      const rel = ruta === "/dashboard/channels" ? "" : ruta.replace("/dashboard/channels", "");
      return !existsSync(join(base, rel, "page.tsx"));
    });

    expect(rotas).toEqual([]);
  });
});
