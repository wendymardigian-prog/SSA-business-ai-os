#!/usr/bin/env node
/**
 * Verificacion del modulo de Tareas contra la base real.
 *
 * Lanza la version TypeScript con vite-node: lo que se prueba es la base de verdad (RLS,
 * privilegios por columna, RPC atomicas, el cron) con usuarios reales, no una copia en JS.
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. Una limpieza que falla es una
 * prueba que falla. No correrlo en paralelo con otro verify-*.
 *
 *   node scripts/verify-tasks.mjs              # todo lo que ya este aplicado (00196, 00197, 00198, 00199)
 *   node scripts/verify-tasks.mjs --hasta 196  # solo hasta esa migracion
 */

import { spawnSync } from "node:child_process";

const { status } = spawnSync("npx", ["vite-node", "-c", "vitest.config.ts", "scripts/verify-tasks.impl.ts", "--", ...process.argv.slice(2)], { stdio: "inherit" });

process.exitCode = status ?? 1;
