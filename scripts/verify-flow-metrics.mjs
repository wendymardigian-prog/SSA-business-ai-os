#!/usr/bin/env node
/**
 * Verificacion de las metricas por paso del lienzo (00316) contra la base real.
 *
 * Lanza la version TypeScript con vite-node: lo que se prueba es el codigo de verdad (el motor y la consulta de la
 * pantalla), no una copia en JavaScript.
 *
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. Una limpieza que falla es una prueba que falla. No correrlo en
 * paralelo con otro verify-*: tomar el candado /private/tmp/ssa-verify.lock.
 *
 *   node scripts/verify-flow-metrics.mjs
 */

import { spawnSync } from "node:child_process";

const { status } = spawnSync("npx", ["vite-node", "-c", "vitest.config.ts", "scripts/verify-flow-metrics.impl.ts"], { stdio: "inherit" });

process.exitCode = status ?? 1;
