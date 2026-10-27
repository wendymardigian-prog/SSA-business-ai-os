#!/usr/bin/env node
// Simula el export de una plantilla y corre el chequeo de tipos sobre la copia.
//
//   node scripts/plantilla/simulate-export.mjs [--perfil=estudiantes] [--out=carpeta] [--keep] [--no-tsc] [--buildinfo=archivo]
//
// Con --buildinfo, tsc corre incremental guardando su estado en ese archivo (fuera de la copia):
// la segunda corrida solo vuelve a mirar lo que cambio.
//
// Pasos:
//   1. Copia el repo a una carpeta temporal (sin node_modules, .next, .git, .claude ni docs).
//   2. Borra las rutas de los modulos que la plantilla no lleva (y pone sus reemplazos).
//   3. Saca lo marcado con las marcas de la plantilla (ver markers.mjs) en cada archivo.
//   4. Enlaza node_modules del repo (no lo copia).
//   5. Corre `tsc --noEmit` con el tsconfig de la copia. Sale con 1 si hay errores.
//
// No toca el repo. Es la prueba fuerte de que la plantilla compila sin los modulos;
// la F4 la convierte en el export de verdad.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { hasMarkers, stripMarkers } from "./markers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name) => process.argv.includes(`--${name}`);

const perfil = arg("perfil") ?? "estudiantes";
const profile = await import(pathToFileURL(join(here, "perfiles", `${perfil}.mjs`)).href);
const { MODULES, EXCLUDED, excludeTests = [], isToolingPath } = profile;

const out = resolve(arg("out") ?? mkdtempSync(join(tmpdir(), `plantilla-${perfil}-`)));
const SKIP_TOP = new Set(["node_modules", ".next", ".git", ".claude", "docs", "tsconfig.tsbuildinfo", ".plantilla-work", "BITACORA.md"]);
const TEXT = /\.(ts|tsx|mts|mjs|js|cjs|css|sql|json|md)$/;

// 1. Copia
if (existsSync(out) && readdirSync(out).length > 0 && arg("out")) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const name of readdirSync(repo)) {
  if (SKIP_TOP.has(name)) continue;
  cpSync(join(repo, name), join(out, name), {
    recursive: true,
    filter: (src) => !/(^|\/)(node_modules|\.next)(\/|$)/.test(relative(repo, src)),
  });
}

// 2. Borrar lo de los modulos (y las herramientas de la plantilla)
const removed = [];
const rm = (rel) => {
  const p = join(out, rel);
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    removed.push(rel);
  }
};
for (const id of EXCLUDED) {
  for (const rel of MODULES[id].paths) rm(rel);
  for (const [dest, src] of Object.entries(MODULES[id].replacements ?? {})) {
    cpSync(join(repo, src), join(out, dest), { recursive: true });
  }
}
for (const t of excludeTests) if (t.modules.some((m) => EXCLUDED.includes(m))) rm(t.path);
const walk = (dir, acc = []) => {
  for (const name of readdirSync(join(out, dir))) {
    const rel = dir ? `${dir}/${name}` : name;
    if (rel === "node_modules") continue;
    const st = statSync(join(out, rel));
    if (st.isDirectory()) walk(rel, acc);
    else acc.push(rel);
  }
  return acc;
};
for (const rel of walk("")) if (isToolingPath(rel)) rm(rel);

// 3. Sacar lo marcado
let stripped = 0;
const errors = [];
for (const rel of walk("")) {
  if (!TEXT.test(rel)) continue;
  const p = join(out, rel);
  const text = readFileSync(p, "utf8");
  if (!hasMarkers(text)) continue;
  try {
    const next = stripMarkers(text, EXCLUDED, Object.keys(MODULES));
    if (next !== text) {
      writeFileSync(p, next);
      stripped++;
    }
  } catch (e) {
    errors.push(`${rel}: ${e.message}`);
  }
}
if (errors.length) {
  console.error("Marcas con errores:\n" + errors.join("\n"));
  process.exit(1);
}

// 4. node_modules
symlinkSync(join(repo, "node_modules"), join(out, "node_modules"), "dir");

console.log(`Copia en ${out}`);
console.log(`Rutas borradas: ${removed.length}. Archivos con marcas aplicadas: ${stripped}.`);

// 5. tsc
let code = 0;
if (!flag("no-tsc")) {
  const tsc = spawnSync(join(repo, "node_modules", ".bin", "tsc"), ["--noEmit", ...(arg("buildinfo") ? ["--incremental", "--tsBuildInfoFile", resolve(arg("buildinfo"))] : ["--incremental", "false"]), "-p", out], {
    cwd: out,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = (tsc.stdout + tsc.stderr).split("\n").filter((l) => /error TS/.test(l));
  writeFileSync(join(out, ".tsc-errors.txt"), tsc.stdout + tsc.stderr);
  if (lines.length) {
    console.log(`tsc: ${lines.length} errores (detalle en ${join(out, ".tsc-errors.txt")})`);
    code = 1;
  } else if (tsc.status !== 0) {
    console.log(tsc.stdout + tsc.stderr);
    code = 1;
  } else console.log("tsc: 0 errores");
}
if (!flag("keep") && code === 0 && !arg("out")) rmSync(out, { recursive: true, force: true });
process.exit(code);
