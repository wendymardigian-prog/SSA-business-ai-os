#!/usr/bin/env node
/**
 * Verificacion de la suscripcion a emails (00270-00272) contra la base real.
 *
 * Lanza la version TypeScript con vite-node (asi prueba tambien la baja por token
 * del codigo, no una copia en JS). Crea un workspace `zz-test-` y lo borra al
 * terminar. No correrlo en paralelo con otro verify-* (candado
 * /private/tmp/ssa-verify.lock).
 *
 *   node scripts/verify-email-subscription.mjs
 *
 * Se corre desde la carpeta del repo que tiene el `.env` y la CLI de Supabase vinculada.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// El codigo y la config salen de la carpeta de ESTE script (puede ser un worktree); el `.env`, de donde se corre.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { status } = spawnSync(
  "npx",
  ["vite-node", "-c", join(root, "vitest.config.ts"), join(root, "scripts", "verify-email-subscription.impl.ts"), "--", ...process.argv.slice(2)],
  { stdio: "inherit" },
);

process.exitCode = status ?? 1;
