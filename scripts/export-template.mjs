#!/usr/bin/env node
/**
 * Exporta una copia limpia de este repo como punto de partida para un
 * cliente nuevo (white label).
 *
 * Este repo tiene su historia interna (docs/, BITACORA.md), carpetas propias
 * de la sesion de Claude Code (claude/, .claude/worktrees/) y secretos
 * locales (.env*, supabase/.temp/, .mcp.json). Nada de eso tiene que viajar
 * al clon de un cliente: este script copia todo lo demas tal cual, le
 * arma una historia de git nueva (un solo commit, sin rastro del historial de
 * este repo) y al final corre un grep de control que busca nombres y
 * dominios identificables. Si el control encuentra algo, el script NO borra
 * la copia ya exportada: hay que mirar que encontro, arreglarlo en el repo de
 * origen, y volver a correr el export.
 *
 *   node scripts/export-template.mjs [--out=../ruta]
 *
 * Sin --out, el destino es "../template-export" (carpeta hermana del repo).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  readFileSync,
} from "node:fs";
import { join, dirname, resolve, relative, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
}

const outArg = arg("out") || "../template-export";
const DEST = resolve(REPO_ROOT, outArg);

// --- Que NO se copia -------------------------------------------------------
//
// Rutas relativas a la raiz del repo (con "/" como separador, sea cual sea
// el sistema operativo). `.mcp.json.example` queda afuera de la exclusion de
// `.mcp.json` a proposito: es el placeholder, se copia.
function isExcluded(relPath) {
  if (relPath === "docs" || relPath.startsWith("docs/")) return true;
  if (relPath === "BITACORA.md") return true;
  if (relPath === "claude" || relPath.startsWith("claude/")) return true;
  if (relPath === ".claude/worktrees" || relPath.startsWith(".claude/worktrees/")) return true;
  if (relPath === "supabase/.temp" || relPath.startsWith("supabase/.temp/")) return true;
  if (relPath === ".mcp.json") return true;
  if (relPath === "node_modules" || relPath.startsWith("node_modules/") || /(^|\/)node_modules(\/|$)/.test(relPath)) return true;
  if (relPath === ".next" || relPath.startsWith(".next/") || /(^|\/)\.next(\/|$)/.test(relPath)) return true;
  if (relPath === ".git" || relPath.startsWith(".git/")) return true;
  if (/^\.env/.test(basename(relPath))) return true;
  return false;
}

// --- Copia recursiva --------------------------------------------------------

let filesCopied = 0;

function copyTree(srcDir, destDir, relDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (isExcluded(relPath)) continue;
    if (entry.isSymbolicLink()) continue; // no hay en este repo; si aparece uno, se ignora en vez de romper

    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyTree(srcPath, destPath, relPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
      filesCopied += 1;
    }
  }
}

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "pipe" });
}

// --- Control final: nombres y dominios identificables -----------------------
//
// Mismo patron que se uso durante la limpieza manual de docs/. LICENSE,
// THIRD_PARTY_NOTICES.md y CLAUDE.md quedan afuera porque tienen permiso de
// nombrar el fork de ZernFlow. Este mismo archivo tambien queda afuera por
// una razon distinta: para poder buscar estas palabras tiene que nombrarlas,
// asi que siempre se encontraria a si mismo.
const SELF_CHECK_PATTERN = /wendy|mardigian|scaleos|zernflow|50670814873|knrxjn/i;
const SELF_CHECK_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".sql", ".md", ".json"]);
const SELF_CHECK_ALLOWED_FILES = new Set([
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "CLAUDE.md",
  "export-template.mjs",
]);

function selfCheck(dir, relDir, matches) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      selfCheck(fullPath, relPath, matches);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SELF_CHECK_ALLOWED_FILES.has(entry.name)) continue;
    if (!SELF_CHECK_EXTENSIONS.has(extname(entry.name))) continue;

    const content = readFileSync(fullPath, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      if (SELF_CHECK_PATTERN.test(line)) {
        matches.push(`${relPath}:${index + 1}`);
      }
    });
  }
}

// --- Main --------------------------------------------------------------------

function main() {
  if (existsSync(DEST)) {
    console.error(`Ya existe "${DEST}". Borrala o elegi otro --out antes de exportar de nuevo.`);
    process.exit(1);
  }

  console.log(`Exportando ${REPO_ROOT} -> ${DEST}`);
  copyTree(REPO_ROOT, DEST, "");
  console.log(`Copiados ${filesCopied} archivos.`);

  try {
    run("git", ["init"], DEST);
    run("git", ["add", "-A"], DEST);
    run("git", ["commit", "-m", "chore: punto de partida del template, exportado de SSA Business AI OS"], DEST);
  } catch (error) {
    console.error("No se pudo inicializar el git del template (la copia ya exportada queda en el disco para revisarla):");
    console.error(error.message);
    process.exit(1);
  }

  const matches = [];
  selfCheck(DEST, "", matches);

  if (matches.length > 0) {
    console.error(`\nEl control encontro ${matches.length} resto(s) identificable(s) (nombre o dominio, no credenciales) en la copia exportada:`);
    for (const match of matches) console.error(`  ${match}`);
    console.error("\nLa copia NO se borro: queda en el disco para revisarla. Arregla el repo de origen y volve a correr el export.");
    process.exit(1);
  }

  console.log(`\nExport limpio: ${filesCopied} archivos, sin restos identificables.`);
  console.log(`Destino: ${DEST}`);
}

main();
