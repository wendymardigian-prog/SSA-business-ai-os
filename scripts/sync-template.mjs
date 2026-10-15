#!/usr/bin/env node
/**
 * Pone al dia la plantilla de clientes (el repo con el boton "Use this template")
 * con lo que hay hoy en este repo, SIN romper su historial.
 *
 * Por que no se re-exporta desde cero: los clientes enganchan la plantilla como
 * `upstream` y traen las mejoras con `git merge`. Si la historia de la plantilla
 * se reescribe, ese merge se rompe. Por eso la plantilla solo crece: cada
 * actualizacion es un commit nuevo encima del anterior.
 *
 *   node scripts/sync-template.mjs --template=../ruta/a/la/copia-de-la-plantilla
 *
 * Que hace:
 *   1. Regenera supabase/migrations/ALL_MIGRATIONS.sql (el que pegan los clientes).
 *   2. Exporta una copia limpia a una carpeta temporal (scripts/export-template.mjs,
 *      con su control de nombres y dominios identificables: si falla, se corta aca).
 *   3. La espeja encima de la copia local de la plantilla (agrega, cambia Y BORRA lo
 *      que ya no existe), sin tocar su `.git`.
 *   4. Muestra el resumen de cambios. NO hace commit ni push: eso lo decide una
 *      persona despues de mirar. (Publicar es una accion hacia afuera.)
 *
 * Antes de correrlo: este repo tiene que estar en `main`, al dia y sin cambios sin
 * guardar, y la copia de la plantilla tiene que estar en `main`, al dia (`git pull`)
 * y sin cambios sin guardar.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const templateArg = arg("template");
if (!templateArg) {
  fail("Falta --template=<carpeta>: la copia local de la plantilla (por ejemplo ../business-os-template).");
}
const TEMPLATE = resolve(process.cwd(), templateArg);

// --- Chequeos antes de tocar nada --------------------------------------------

if (!existsSync(join(TEMPLATE, ".git"))) {
  fail(`"${TEMPLATE}" no es un repo de git. Clonalo primero: git clone <link de la plantilla> <carpeta>.`);
}
if (resolve(TEMPLATE) === resolve(REPO_ROOT)) {
  fail("--template apunta a ESTE repo. Tiene que ser la copia local de la plantilla, otra carpeta.");
}

const sourceRemote = git(REPO_ROOT, "remote", "get-url", "origin").toLowerCase();
const templateRemote = git(TEMPLATE, "remote", "get-url", "origin").toLowerCase();
if (sourceRemote === templateRemote) {
  fail("Las dos carpetas apuntan al mismo repositorio en GitHub. La plantilla tiene que ser otro repo.");
}

const sourceBranch = git(REPO_ROOT, "rev-parse", "--abbrev-ref", "HEAD");
if (sourceBranch !== "main") {
  fail(`Este repo esta en "${sourceBranch}". La plantilla se corta siempre desde main, ya mergeado y probado.`);
}
if (git(REPO_ROOT, "status", "--porcelain")) {
  fail("Este repo tiene cambios sin guardar (commit). La plantilla tiene que salir de lo que esta commiteado.");
}

const templateBranch = git(TEMPLATE, "rev-parse", "--abbrev-ref", "HEAD");
if (templateBranch !== "main") {
  fail(`La copia de la plantilla esta en "${templateBranch}". Pasate a main: git checkout main.`);
}
if (git(TEMPLATE, "status", "--porcelain")) {
  fail("La copia de la plantilla tiene cambios sin guardar. Commitealos o descartalos antes de sincronizar.");
}
execFileSync("git", ["pull", "--ff-only"], { cwd: TEMPLATE, stdio: "inherit" });

// --- 1. ALL_MIGRATIONS al dia ------------------------------------------------

execFileSync("node", ["scripts/build-all-migrations.mjs"], { cwd: REPO_ROOT, stdio: "inherit" });
if (git(REPO_ROOT, "status", "--porcelain", "supabase/migrations/ALL_MIGRATIONS.sql")) {
  fail(
    "ALL_MIGRATIONS.sql estaba desactualizado y se regenero. Commitealo en main, y volve a correr esto.\n" +
      "(Los clientes pegan ese archivo: tiene que coincidir con las migraciones.)",
  );
}

// --- 2. Export limpio a una carpeta temporal ---------------------------------

const tmp = mkdtempSync(join(tmpdir(), "sync-template-"));
const exported = join(tmp, "export");
try {
  const exportRun = spawnSync("node", ["scripts/export-template.mjs", `--out=${exported}`], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (exportRun.status !== 0) {
    fail("El export no paso su control. Arreglalo en este repo y volve a correr. La plantilla NO se toco.");
  }

  // --- 3. Espejar encima de la plantilla, sin tocar su .git -------------------

  execFileSync("rsync", ["-a", "--delete", "--exclude=/.git", `${exported}/`, `${TEMPLATE}/`], {
    stdio: "inherit",
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// --- 4. Resumen --------------------------------------------------------------

const changes = git(TEMPLATE, "status", "--porcelain");
if (!changes) {
  console.log("\nLa plantilla ya estaba al dia: no hay nada para publicar.");
  process.exit(0);
}

const lines = changes.split("\n");
const count = (re) => lines.filter((l) => re.test(l)).length;
const newest = git(REPO_ROOT, "log", "-1", "--format=%h %s");
console.log(`\nCambios en la plantilla: ${lines.length} archivos`);
console.log(`  nuevos: ${count(/^\?\?|^A/)}, modificados: ${count(/^ ?M/)}, borrados: ${count(/^ ?D/)}`);
console.log(`Basado en main de este repo: ${newest}`);
console.log(`\nSiguiente paso (lo hacés vos, mirando antes con "git status" y "git diff"):`);
console.log(`  cd ${TEMPLATE}`);
console.log(`  git add -A && git commit -m "feat: <que trae esta actualizacion, en una linea>"`);
console.log(`  git push origin main`);
