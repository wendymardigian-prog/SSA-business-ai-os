#!/usr/bin/env node
/**
 * Compila el script de embed (F39): `lib/embed/entry.ts` -> `public/embed/embed.js`.
 *
 * Es un IIFE para es2017: se carga con una etiqueta <script> en la pagina de
 * cualquiera, asi que no puede depender de modulos ni de nada del proyecto.
 *
 * El archivo compilado SE COMMITEA. En Railway el build corre `npm ci
 * --omit=dev` y esbuild llega solo como dependencia de vite/vitest, que son
 * de desarrollo: si el script no estuviera en el repo, el deploy quedaria sin
 * `/embed/embed.js` y todos los embeds del cliente dejarian de cargar. Con el
 * archivo commiteado, este script solo lo regenera cuando esbuild esta.
 *
 *   node scripts/build-embed.mjs
 */

import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT = join(process.cwd(), "public/embed/embed.js");
const ENTRY = join(process.cwd(), "lib/embed/entry.ts");

async function main() {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    // Sin esbuild (por ejemplo, un deploy sin dependencias de desarrollo) se
    // usa el archivo que ya está commiteado. No es un error.
    if (existsSync(OUT)) {
      console.log("[embed] esbuild no está: se usa public/embed/embed.js commiteado");
      return;
    }
    console.error("[embed] esbuild no está y no hay public/embed/embed.js commiteado");
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    target: "es2017",
    minify: true,
    outfile: OUT,
    legalComments: "none",
    banner: { js: "/* Agenda embed — generado por scripts/build-embed.mjs. No editar a mano. */" },
    logLevel: "warning",
  });

  if (result.errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  const { statSync } = await import("node:fs");
  console.log(`[embed] public/embed/embed.js — ${(statSync(OUT).size / 1024).toFixed(1)} KB`);
}

await main();
