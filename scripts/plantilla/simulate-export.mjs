#!/usr/bin/env node
// Simula el export de una plantilla y corre controles sobre la copia.
//
//   node scripts/plantilla/simulate-export.mjs [--perfil=estudiantes] [--out=carpeta] [--keep]
//        [--no-tsc] [--buildinfo=archivo] [--vitest] [--controles=tsc,eslint,vitest,build,historia]
//        [--vitest-args="lib/agent --testTimeout=120000"]
//
// Con --buildinfo, tsc corre incremental guardando su estado en ese archivo (fuera de la copia):
// la segunda corrida solo vuelve a mirar lo que cambio.
//
// Pasos:
//   1. Copia el repo a una carpeta temporal (sin node_modules, .next, .git, .claude ni docs).
//   2. Aplica el perfil (export-profile.mjs): borra los modulos, saca lo marcado, pone las
//      migraciones consolidadas de la plantilla y sus archivos propios.
//   3. Enlaza node_modules del repo (no lo copia).
//   4. Corre `tsc --noEmit` (salvo --no-tsc) y, con --vitest o --controles, los demas.
//
// No toca el repo. Es la prueba rapida; el export de verdad es
// `node scripts/export-template.mjs --perfil=estudiantes`.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { applyProfile, loadProfile, runGates } from "./export-profile.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name) => process.argv.includes(`--${name}`);

const perfil = arg("perfil") ?? "estudiantes";
const profile = await loadProfile(perfil);

const out = resolve(arg("out") ?? mkdtempSync(join(tmpdir(), `plantilla-${perfil}-`)));
const SKIP_TOP = new Set(["node_modules", ".next", ".git", ".claude", "docs", "tsconfig.tsbuildinfo", ".plantilla-work", "BITACORA.md"]);

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

// 2. El perfil
let summary;
try {
  summary = applyProfile({ repo, out, profile });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// 3. node_modules
symlinkSync(join(repo, "node_modules"), join(out, "node_modules"), "dir");

console.log(`Copia en ${out}`);
console.log(`Rutas borradas: ${summary.removed.length}. Archivos con marcas aplicadas: ${summary.stripped}.`);

// 4. Controles
let code = 0;
if (!flag("no-tsc") && !arg("controles")) {
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
const only = arg("controles")?.split(",") ?? (flag("vitest") ? ["vitest"] : null);
if (only) {
  const vitestArgs = arg("vitest-args")?.split(/\s+/).filter(Boolean) ?? [];
  for (const r of runGates(out, { only, vitestArgs })) {
    console.log(`${r.name}: ${r.ok ? "ok" : "FALLA"} (${r.detail}, ${r.seconds} s) -> ${r.log}`);
    if (!r.ok) code = 1;
  }
}
if (!flag("keep") && code === 0 && !arg("out")) rmSync(out, { recursive: true, force: true });
process.exit(code);
