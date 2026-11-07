#!/usr/bin/env node
/**
 * Verificación del Diseñador IA contra la base real (F68).
 *
 * Lanza la versión TypeScript con vite-node. Cada bloque vive en su archivo (`scripts/verify-designer/verify-<bloque>.ts`)
 * y tiene un solo dueño. El render va SIEMPRE simulado (`DESIGNER_FAKE_RENDER=1`): nunca llama al servicio real.
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. Una limpieza que falla es una prueba que falla.
 * No correrlo en paralelo con otro verify-* (candado /private/tmp/ssa-verify.lock).
 *
 *   node scripts/verify-designer.mjs                 # todos los bloques que existen
 *   node scripts/verify-designer.mjs --bloque ds0    # uno solo
 */

import { spawnSync } from "node:child_process";

const { status } = spawnSync("npx", ["vite-node", "-c", "vitest.config.ts", "scripts/verify-designer/run.ts", "--", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, DESIGNER_FAKE_RENDER: "1" },
});

process.exitCode = status ?? 1;
