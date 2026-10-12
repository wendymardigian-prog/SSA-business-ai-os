#!/usr/bin/env node
/**
 * Verificacion del modulo Formularios contra la base real.
 *
 * Lanza la version TypeScript con vite-node, porque lo que hay que probar es el
 * codigo de verdad (el envio, el beacon, la huella) y no una copia en JavaScript
 * que podria divergir. Resend y la IA van SIMULADOS: no se llama a
 * ningun proveedor real.
 *
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. Una limpieza que
 * falla es una prueba que falla. No correrlo en paralelo con otro verify-*.
 *
 *   node scripts/verify-forms.mjs
 */

import { spawnSync } from "node:child_process";

const { status } = spawnSync(
  "npx",
  ["vite-node", "-c", "vitest.config.ts", "scripts/verify-forms.impl.ts"],
  { stdio: "inherit" },
);

process.exitCode = status ?? 1;
