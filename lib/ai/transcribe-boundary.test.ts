/**
 * El resto del sistema no sabe quien transcribe (F6).
 *
 * `transcribeAudio` es la unica puerta: ni el job, ni la bandeja, ni el agente
 * mencionan a Groq. Eso no es prolijidad, es lo que hace que cambiar de
 * proveedor —o sumar un gateway el dia de mañana— sea un `case` en
 * `buildTranscriber` y una fila en el catalogo, en vez de un grep por todo el
 * repo.
 *
 * Este test recorre el codigo de aplicacion y falla si "groq" aparece fuera de
 * los tres archivos que tienen derecho a nombrarlo. Mismo criterio que
 * lib/vault-boundary.test.ts.
 *
 * Ojo con el nombre: **Groq** (con Q) corre modelos abiertos en hardware propio
 * y es el que usamos. **Grok** (con K) es el modelo de xAI y no tiene nada que
 * ver. En prompts, variables y documentacion va siempre `groq`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app", "components"];
const EXTENSIONS = [".ts", ".tsx"];

/**
 * Los tres que pueden nombrarlo:
 *
 *   - transcribe.ts        es el que habla con el proveedor.
 *   - providers.ts         es el catalogo: una integracion es una fila.
 *   - ai-key-check.ts      prueba la clave, y eso es parte del catalogo.
 *   - secret-names.ts      el nombre del secreto en Vault.
 */
const ALLOWED = [
  "lib/ai/transcribe.ts",
  "lib/integrations/providers.ts",
  "lib/integrations/ai-key-check.ts",
  "lib/secret-names.ts",
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

describe("la frontera del proveedor de transcripcion (F6)", () => {
  it('"groq" no aparece en el codigo de aplicacion fuera de los cuatro archivos que pueden nombrarlo', () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (ALLOWED.includes(rel)) continue;
        if (/groq/i.test(readFileSync(file, "utf8"))) offenders.push(rel);
      }
    }

    expect(offenders, `mencionan a Groq y no deberian:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("y los cuatro que pueden nombrarlo siguen existiendo (si se renombra uno, este test lo dice)", () => {
    for (const rel of ALLOWED) {
      expect(() => statSync(join(ROOT, rel)), rel).not.toThrow();
      expect(/groq/i.test(readFileSync(join(ROOT, rel), "utf8")), rel).toBe(true);
    }
  });
});
