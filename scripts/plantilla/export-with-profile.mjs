// El export de una plantilla con perfil, despues de la copia de `scripts/export-template.mjs`.
//
//   node scripts/export-template.mjs --perfil=estudiantes [--out=../ruta] [--skip-gates]
//
// 1. Aplica el perfil (export-profile.mjs): modulos, marcas, migraciones consolidadas,
//    archivos propios de la plantilla y paquetes.
// 2. Actualiza package-lock.json (`npm install --package-lock-only`, sin red si se puede).
// 3. Clona (o enlaza) node_modules del repo y regenera public/embed/embed.js con el codigo ya podado.
// 4. Controles: tsc, eslint (0 errores), vitest (un archivo que falla se reintenta una vez:
//    hay tests de tiempo que fallan con la maquina cargada), next build, el de nombres del
//    export de siempre y el de historia. El de historia frena por lo que cuente la historia del
//    proyecto en un comentario (numeros de migracion, fechas, codigos de requerimiento, etapas,
//    palabras de modulos que no viajan), por un nombre propio o un PR en cualquier texto, y por
//    los comentarios que la limpieza no pudo arreglar sola; lo que esta fuera de los comentarios
//    (strings, nombres de tests) se informa en el mismo archivo.
//    El de textos frena por un texto que se ve en la pantalla (o que se le manda a la IA) y nombra
//    un modulo que la plantilla no lleva (visible-strings.mjs, con sus excepciones explicadas).
// 5. Si todo pasa: limpia lo que dejaron los controles y arma el git (un solo commit).
//
// Los registros de cada control quedan en "<destino>-controles/" (fuera de la copia).
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { applyProfile, cleanGateArtifacts, findHistoryInCopy, historyReport, loadProfile, runGates } from "./export-profile.mjs";
import { findVisibleModuleStrings, visibleReport } from "./visible-strings.mjs";

export async function exportWithProfile({ repo, dest, perfil, skipGates, selfCheck, gitInit }) {
  const started = Date.now();
  const secs = () => Math.round((Date.now() - started) / 1000);
  const profile = await loadProfile(perfil);
  const logDir = `${dest}-controles`;
  rmSync(logDir, { recursive: true, force: true });

  // 1. El perfil.
  const summary = applyProfile({ repo, out: dest, profile });
  console.log(`Perfil "${perfil}": ${summary.removed.length} rutas borradas, marcas aplicadas en ${summary.stripped} archivos, ${summary.overlaid.length} archivos propios de la plantilla.`);
  if (summary.depsRemoved.length) console.log(`Paquetes sacados del package.json: ${summary.depsRemoved.join(", ")}.`);
  console.log(`Comentarios limpiados: ${summary.commentsCleaned}${summary.commentWarnings.length ? ` (${summary.commentWarnings.length} para reescribir a mano)` : ""}.`);

  // 2. package-lock.json.
  if (summary.depsRemoved.length) {
    const npm = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], { cwd: dest, encoding: "utf8" });
    if (npm.status === 0) console.log("package-lock.json actualizado.");
    else console.warn(`No se pudo actualizar package-lock.json (queda el del proyecto; correr "npm install" en la plantilla):\n${npm.stderr}`);
  }

  // 3. node_modules y el embed. `next build` (Turbopack) no acepta un node_modules enlazado que
  // apunta fuera de la carpeta: se clona (copia sin duplicar espacio en APFS, `cp -c`); si el
  // sistema no sabe clonar, se enlaza (alcanza para tsc, eslint y vitest).
  const clone = spawnSync("cp", ["-cR", join(repo, "node_modules"), join(dest, "node_modules")], { encoding: "utf8" });
  if (clone.status !== 0) {
    rmSync(join(dest, "node_modules"), { recursive: true, force: true });
    symlinkSync(join(repo, "node_modules"), join(dest, "node_modules"), "dir");
    console.warn("No se pudo clonar node_modules: se enlaza (next build puede fallar con Turbopack).");
  }
  const embed = spawnSync(process.execPath, ["scripts/build-embed.mjs"], { cwd: dest, encoding: "utf8" });
  if (embed.status !== 0) {
    console.error(`No se pudo regenerar public/embed/embed.js:\n${embed.stdout}${embed.stderr}`);
    return false;
  }
  console.log(`public/embed/embed.js regenerado. [${secs()} s]`);

  if (skipGates) {
    cleanGateArtifacts(dest);
    // El de historia es rapido y no necesita node_modules: se informa igual (sin frenar).
    const report = historyReport(findHistoryInCopy(dest), summary.commentWarnings);
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, "historia.txt"), report.text);
    console.log(`Historia: ${report.detail} (detalle en ${join(logDir, "historia.txt")})`);
    const visible = visibleReport(findVisibleModuleStrings(dest));
    writeFileSync(join(logDir, "textos.txt"), visible.text);
    console.log(`Textos visibles: ${visible.detail} (detalle en ${join(logDir, "textos.txt")})`);
    console.log(`\n--skip-gates: no se corrieron los controles ni se armo el git. Copia en ${dest}`);
    return true;
  }

  // 4. Controles.
  const results = [];
  const show = (r) => console.log(`  ${r.ok ? "ok   " : "FALLA"} ${r.name}: ${r.detail} (${r.seconds} s)${r.ok ? "" : ` -> ${r.log}`}`);
  console.log("\nControles:");
  for (const name of ["tsc", "eslint", "vitest", "build"]) {
    let [r] = runGates(dest, { only: [name], logDir, vitestArgs: name === "vitest" ? ["--testTimeout=120000"] : [] });
    if (name === "vitest" && !r.ok) {
      // Un reintento solo de los archivos que fallaron (tests de tiempo con la maquina cargada).
      const failed = [...new Set([...readFileSync(r.log, "utf8").matchAll(/^\s*FAIL\s+(\S+\.test\.tsx?)/gm)].map((m) => m[1]))];
      if (failed.length && failed.length <= 10) {
        const [retry] = runGates(dest, { only: ["vitest"], logDir: `${logDir}/reintento`, vitestArgs: ["--testTimeout=120000", ...failed] });
        if (retry.ok) r = { ...r, ok: true, detail: `${r.detail}; ${failed.length} archivo(s) pasaron al reintentarlos: ${failed.join(", ")}` };
      }
    }
    show(r);
    results.push(r);
  }
  // Lo que dejaron los controles (.next, el enlace a node_modules) no se revisa ni viaja.
  cleanGateArtifacts(dest);

  const names = selfCheck(dest);
  const namesResult = { name: "nombres", ok: names.length === 0, detail: names.length ? `${names.length} restos: ${names.slice(0, 10).join(", ")}` : "ninguno", seconds: 0 };
  show(namesResult);
  results.push(namesResult);

  const report = historyReport(findHistoryInCopy(dest), summary.commentWarnings);
  const historyLog = join(logDir, "historia.txt");
  writeFileSync(historyLog, report.text);
  const historyResult = { name: "historia", ok: report.ok, detail: `${report.detail} (detalle en ${historyLog})`, seconds: 0, log: historyLog };
  show(historyResult);
  results.push(historyResult);

  const visible = visibleReport(findVisibleModuleStrings(dest));
  const visibleLog = join(logDir, "textos.txt");
  writeFileSync(visibleLog, visible.text);
  const visibleResult = { name: "textos", ok: visible.ok, detail: `${visible.detail} (detalle en ${visibleLog})`, seconds: 0, log: visibleLog };
  show(visibleResult);
  results.push(visibleResult);

  const ok = results.every((r) => r.ok);
  writeFileSync(join(logDir, "resumen.txt"), results.map((r) => `${r.ok ? "ok" : "FALLA"}\t${r.name}\t${r.detail}\t${r.seconds} s`).join("\n") + `\ntotal\t${secs()} s\n`);

  // 5. El git, solo si todo paso.
  if (!ok) {
    console.error(`\nAlgun control fallo: la copia queda en ${dest} SIN git, para revisarla. Registros en ${logDir}.`);
    return false;
  }
  if (existsSync(join(dest, ".git"))) rmSync(join(dest, ".git"), { recursive: true, force: true });
  gitInit();
  console.log(`\nPlantilla "${perfil}" exportada en ${dest} (un solo commit). Todos los controles pasaron. [${secs()} s]`);
  return true;
}
