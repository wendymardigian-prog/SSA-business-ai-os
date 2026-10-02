/**
 * Las tablas viejas (`response_templates`, `audio_assets`) no pueden
 * quedar en el codigo de aplicacion.
 *
 * La fusion en `response_assets` (migraciones 00105/00106) reemplaza a las
 * dos. Este test recorre el codigo de aplicacion y falla si cualquiera de
 * los dos nombres aparece fuera de las migraciones SQL (que tienen derecho a
 * nombrar una tabla vieja: son historia). Mismo criterio que
 * lib/ai/transcribe-boundary.test.ts.
 *
 * Suma `scripts/` y `.mjs` a lo que escanea lib/vault-boundary.test.ts y
 * lib/ai/transcribe-boundary.test.ts: `scripts/verify-chat-media.mjs` es el
 * unico archivo fuera de lib/app/components que consulta la tabla, y es
 * justo la clase de archivo que un rename se olvida -- no lo toca el
 * compilador, no lo corre ningun test, y falla recien cuando alguien lo
 * ejecuta a mano contra la base.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app", "components", "scripts"];
const EXTENSIONS = [".ts", ".tsx", ".mjs"];
const FORBIDDEN = /\baudio_assets\b|\bresponse_templates\b/;

/** Cero excepciones: la fusion dice que no puede quedar ninguna referencia. */
const ALLOWED: string[] = [];

/**
 * Los archivos que SI tienen que nombrar `response_assets`: si un rename los
 * vacia en silencio (por ejemplo, alguien vuelve a escribir `audio_assets`
 * en uno de estos), este test lo dice.
 */
const MUST_QUERY = [
  "lib/actions/response-assets.ts",
  "lib/response-assets/transcribe.ts",
  "lib/agent/tools/assets.ts",
  "lib/agent/drafts/actions.ts",
  "lib/types/database.ts",
  "app/(dashboard)/dashboard/(comunicacion)/inbox/page.tsx",
  "scripts/verify-chat-media.mjs",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((e) => entry.endsWith(e)) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

describe("la frontera de la banca de recursos (fusion de response_templates y audio_assets)", () => {
  it("ninguna de las dos tablas viejas aparece en el codigo de aplicacion", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (ALLOWED.includes(rel)) continue;
        if (FORBIDDEN.test(readFileSync(file, "utf8"))) offenders.push(rel);
      }
    }

    expect(offenders, `mencionan una tabla vieja y no deberian:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("los archivos que tienen que usar response_assets siguen haciendolo", () => {
    for (const rel of MUST_QUERY) {
      expect(() => statSync(join(ROOT, rel)), rel).not.toThrow();
      expect(existsSync(join(ROOT, rel)), rel).toBe(true);
      expect(readFileSync(join(ROOT, rel), "utf8").includes("response_assets"), rel).toBe(true);
    }
  });
});
