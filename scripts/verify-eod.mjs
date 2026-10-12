#!/usr/bin/env node
/**
 * Verificacion de los reportes de fin de dia (EOD) contra la base real.
 *
 * Lanza la version TypeScript con vite-node: lo que se prueba es el codigo de verdad
 * (guardar el borrador, enviar, la RLS, la unicidad) y no una copia en JavaScript.
 *
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. Una limpieza que falla es una
 * prueba que falla. No correrlo en paralelo con otro verify-*.
 *
 *   node scripts/verify-eod.mjs
 */

import { spawnSync } from "node:child_process";

const { status } = spawnSync("npx", ["vite-node", "-c", "vitest.config.ts", "scripts/verify-eod.impl.ts"], { stdio: "inherit" });

process.exitCode = status ?? 1;
