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
 *   3. Controla que la copia traiga SOLO archivos que git sigue en este repo (nada sin
 *      seguimiento ni ignorado, como `Claude outputs/`): si aparece otro, se corta aca.
 *   4. La espeja encima de la copia local de la plantilla (agrega, cambia Y BORRA lo
 *      que ya no existe), sin tocar su `.git`.
 *   5. Muestra el resumen de cambios. NO hace commit ni push: eso lo decide una
 *      persona despues de mirar. (Publicar es una accion hacia afuera.)
 *
 * Antes de correrlo: este repo tiene que estar en `main`, al dia y sin cambios sin
 * guardar, y la copia de la plantilla tiene que estar en `main`, al dia (`git pull`)
 * y sin cambios sin guardar.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
  fail("Falta --template=<carpeta>: la copia local de la plantilla (por ejemplo ../BAIOS-b2b).");
}
const TEMPLATE = resolve(process.cwd(), templateArg);

/** Los archivos de la copia exportada (rutas con "/"), sin su `.git`. */
function exportedFiles(root, rel = "") {
  const files = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (path === ".git") continue;
    if (entry.isDirectory()) files.push(...exportedFiles(root, path));
    else files.push(path);
  }
  return files;
}

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

  // --- 3. Solo lo que git sigue -------------------------------------------------
  //
  // El export ya copia desde `git ls-files`; esto es la segunda llave, porque rsync
  // espeja el DISCO de la copia. El 8/11/2026 viajo "Claude outputs/" (respaldos con
  // datos del negocio) por copiar el disco.
  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z", "--cached"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean),
  );
  // Lo que arma la base consolidada (la foto y la lista de las viejas) no esta en git en ese
  // lugar: sale de plantilla-clientes/ (ver scripts/plantilla/client-baseline.mjs).
  const { clientBaselineFiles } = await import("./plantilla/client-baseline.mjs");
  for (const rel of clientBaselineFiles(REPO_ROOT)) tracked.add(rel);
  const untracked = exportedFiles(exported).filter((rel) => !tracked.has(rel));
  if (untracked.length > 0) {
    rmSync(tmp, { recursive: true, force: true });
    fail(
      `La copia exportada trae ${untracked.length} archivo(s) que git no sigue en este repo:\n` +
        untracked.slice(0, 20).map((rel) => `  ${rel}`).join("\n") +
        "\nLa plantilla NO se toco.",
    );
  }

  // --- 4. Espejar encima de la plantilla, sin tocar su .git -------------------

  execFileSync("rsync", ["-a", "--delete", "--exclude=/.git", `${exported}/`, `${TEMPLATE}/`], {
    stdio: "inherit",
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// --- 5. Resumen --------------------------------------------------------------

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
