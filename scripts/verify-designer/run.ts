/**
 * Corre los bloques de `verify-designer` (todos los que existen, o el de `--bloque`), y limpia al final.
 */

import { existsSync } from "node:fs";
import { runCleanup } from "../test-cleanup.mjs";
import { counters, fail, raw, svc, type Block, type BlockContext } from "./helpers";

const BLOCKS = ["ds0", "ds2", "ds5", "ds6", "ds7", "ds8"] as const;

const args = process.argv.slice(2);
const i = args.indexOf("--bloque");
const only = i >= 0 ? args[i + 1] : null;
if (only && !(BLOCKS as readonly string[]).includes(only)) {
  console.error(`Bloque desconocido: ${only}. Son: ${BLOCKS.join(", ")}`);
  process.exit(2);
}

const ctx: BlockContext = { storagePaths: [] };

try {
  for (const name of BLOCKS) {
    if (only && name !== only) continue;
    const file = new URL(`./verify-${name}.ts`, import.meta.url);
    if (!existsSync(file)) {
      if (only) fail(`el bloque ${name} todavía no existe`);
      continue;
    }
    console.log(`\n═══ Bloque ${name} ═══`);
    const mod = (await import(file.href)) as { default: Block };
    await mod.default(ctx);
  }
} catch (error) {
  fail("el verify se cortó", error instanceof Error ? error.message : String(error));
} finally {
  console.log("\n— Limpieza —");
  for (const { bucket, path } of ctx.storagePaths) {
    const { error } = await raw.storage.from(bucket).remove([path]);
    if (error) fail(`no pude borrar ${bucket}/${path}`, error.message);
  }
  if (!(await runCleanup(svc))) counters.failures++;
  console.log(`\n${counters.oks}/${counters.oks + counters.failures} ok`);
  if (counters.failures > 0) console.error(`${counters.failures} falla(s)`);
  process.exitCode = counters.failures > 0 ? 1 : 0;
}
