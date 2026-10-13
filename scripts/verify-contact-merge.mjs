#!/usr/bin/env node
/**
 * Verificacion de la fusion de contactos (Tareas × CRM, R9) contra la base real.
 *
 * Lanza la version TypeScript con vite-node: lo que se prueba es `merge_contacts` (00207) con la base de verdad y la lista
 * `CONTACT_MERGE_TABLES` del codigo. Crea todo con prefijo `zz-test-` y lo borra al terminar (tambien lo que arma para
 * forzar un fallo a mitad de camino y para probar la guardia). Una limpieza que falla es una prueba que falla.
 * No correrlo en paralelo con otro verify-*.
 *
 *   node scripts/verify-contact-merge.mjs
 */

import { spawnSync } from "node:child_process";

const { status } = spawnSync("npx", ["vite-node", "-c", "vitest.config.ts", "scripts/verify-contact-merge.impl.ts", "--", ...process.argv.slice(2)], { stdio: "inherit" });

process.exitCode = status ?? 1;
