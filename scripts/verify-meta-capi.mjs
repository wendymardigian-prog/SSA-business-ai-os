#!/usr/bin/env node
/**
 * Verificacion de la API de Conversiones de Meta (00328) contra la base real.
 *
 * Lanza la version TypeScript con vite-node: lo que se prueba es el codigo de verdad.
 *
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. Una limpieza que falla es una prueba que falla. No correrlo en
 * paralelo con otro verify-*: tomar el candado /private/tmp/ssa-verify.lock. Nunca llama a Meta.
 *
 *   node scripts/verify-meta-capi.mjs
 */

import { spawnSync } from "node:child_process";

const { status } = spawnSync("npx", ["vite-node", "-c", "vitest.config.ts", "scripts/verify-meta-capi.impl.ts"], { stdio: "inherit" });

process.exitCode = status ?? 1;
