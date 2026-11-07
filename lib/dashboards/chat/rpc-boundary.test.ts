/**
 * El dashboard de Chat consulta por UN solo camino.
 *
 * Una consulta suelta se saltea la cola y el reintento, y le muestra a la persona
 * el error crudo de la base. Este test falla si aparece un `.rpc(` afuera de `rpc.ts`.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = __dirname;
const ALLOWED = new Set(["rpc.ts"]);

describe("el dashboard de Chat consulta por rpc.ts", () => {
  it("ningun modulo llama a .rpc( por su cuenta", () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !ALLOWED.has(f))
      .filter((f) => /\.rpc\s*\(/.test(readFileSync(join(DIR, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
