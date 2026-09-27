#!/usr/bin/env node
/**
 * Verificacion de punta a punta de la publicacion (grupos A y D).
 *
 * Lanza la version TypeScript con vite-node, porque lo que hay que probar es
 * el codigo de verdad —el nucleo de programar, el despachador, el cierre— y
 * no una copia en JavaScript que podria divergir.
 *
 *   node scripts/verify-publishing.mjs
 */

import { spawnSync } from "node:child_process";

const { status } = spawnSync(
  "npx",
  ["vite-node", "-c", "vitest.config.ts", "scripts/verify-publishing.impl.ts"],
  { stdio: "inherit" },
);

process.exitCode = status ?? 1;
