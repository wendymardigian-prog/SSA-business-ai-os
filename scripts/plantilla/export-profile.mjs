// Lo que hace el export de una plantilla con perfil (por ejemplo, la de estudiantes) sobre
// una copia ya hecha del repo. Lo usan `scripts/export-template.mjs --perfil=...` (el export
// de verdad) y `simulate-export.mjs` (la prueba rapida).
//
// Pasos de `applyProfile` (todos sobre la copia, nunca sobre el repo):
//   1. Borra las rutas de los modulos que la plantilla no lleva y los tests de `excludeTests`
//      (y pone los reemplazos que declara el modulo, como el sitio por defecto).
//   2. Borra las herramientas de quien mantiene la plantilla (scripts/plantilla, las
//      migraciones consolidadas, el verificador) y restos de trabajo local.
//   3. Saca lo marcado (ver markers.mjs) en cada archivo de texto.
//   4. Reemplaza supabase/migrations, supabase/seeds y supabase/config.toml por los de la
//      plantilla (`profile.SUPABASE_DIR`).
//   5. Copia encima los archivos propios de la plantilla (`profile.TEMPLATE_FILES`: CLAUDE.md,
//      README.md, .env.example, .claude/...), si la carpeta existe.
//   6. Saca del package.json los paquetes que son solo de un modulo excluido.
//   7. Vuelve a armar supabase/migrations/ALL_MIGRATIONS.sql.
//
// `runGates` corre los controles sobre la copia (con node_modules enlazado del repo):
// tsc, eslint, vitest, next build y el de historia (`findHistoryInCopy`). Devuelve un
// resultado por control; el que llama decide.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { hasMarkers, stripMarkers } from "./markers.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** El perfil de una plantilla (scripts/plantilla/perfiles/<nombre>.mjs). */
export async function loadProfile(name) {
  const file = join(here, "perfiles", `${name}.mjs`);
  if (!existsSync(file)) throw new Error(`No existe el perfil "${name}" (${file}).`);
  return import(pathToFileURL(file).href);
}

const TEXT = /\.(ts|tsx|mts|mjs|js|cjs|css|sql|json|md)$/;

/** Todos los archivos de una carpeta (rutas relativas, con "/"), sin node_modules ni .git. */
export function walkFiles(root, dir = "", acc = []) {
  for (const name of readdirSync(join(root, dir))) {
    if (name === "node_modules" || name === ".git" || name === ".next") continue;
    const rel = dir ? `${dir}/${name}` : name;
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walkFiles(root, rel, acc);
    else acc.push(rel);
  }
  return acc;
}

/** Aplica el perfil sobre la copia `out`. Devuelve un resumen. */
export function applyProfile({ repo, out, profile }) {
  const { MODULES, EXCLUDED, excludeTests = [], isToolingPath, PACKAGES = {}, SUPABASE_DIR, TEMPLATE_FILES } = profile;
  const removed = [];
  const rm = (rel) => {
    const p = join(out, rel);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      removed.push(rel);
    }
  };

  // 1. Modulos y tests que no viajan.
  for (const id of EXCLUDED) {
    for (const rel of MODULES[id].paths) rm(rel);
    for (const [dest, src] of Object.entries(MODULES[id].replacements ?? {})) {
      cpSync(join(repo, src), join(out, dest), { recursive: true });
    }
  }
  for (const t of excludeTests) if (t.modules.some((m) => EXCLUDED.includes(m))) rm(t.path);

  // 2. Herramientas de la plantilla y restos de trabajo local.
  for (const rel of profile.TOOLING ?? []) rm(rel);
  for (const rel of walkFiles(out)) if (isToolingPath(rel)) rm(rel);
  for (const rel of [".plantilla-work", "tsconfig.tsbuildinfo", ".tsc-errors.txt"]) rm(rel);
  if (TEMPLATE_FILES) rm(TEMPLATE_FILES);

  // 3. Lo marcado.
  let stripped = 0;
  const markerErrors = [];
  for (const rel of walkFiles(out)) {
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
      markerErrors.push(`${rel}: ${e.message}`);
    }
  }
  if (markerErrors.length) throw new Error("Marcas con errores:\n" + markerErrors.join("\n"));

  // 4. La base de la plantilla.
  if (SUPABASE_DIR) {
    const from = join(repo, SUPABASE_DIR);
    for (const name of ["migrations", "seeds", "config.toml"]) {
      rmSync(join(out, "supabase", name), { recursive: true, force: true });
      if (existsSync(join(from, name))) cpSync(join(from, name), join(out, "supabase", name), { recursive: true });
    }
  }

  // 5. Los archivos propios de la plantilla, encima de los del proyecto.
  const overlaid = [];
  if (TEMPLATE_FILES && existsSync(join(repo, TEMPLATE_FILES))) {
    for (const rel of walkFiles(join(repo, TEMPLATE_FILES))) {
      mkdirSync(dirname(join(out, rel)), { recursive: true });
      cpSync(join(repo, TEMPLATE_FILES, rel), join(out, rel));
      overlaid.push(rel);
    }
  }

  // 6. Paquetes que son solo de un modulo excluido.
  const depsRemoved = [];
  const pkgPath = join(out, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  for (const [name, mods] of Object.entries(PACKAGES)) {
    if (!mods.some((m) => EXCLUDED.includes(m))) continue;
    for (const field of ["dependencies", "devDependencies"]) {
      if (pkg[field]?.[name]) {
        delete pkg[field][name];
        depsRemoved.push(name);
      }
    }
  }
  if (depsRemoved.length) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // 7. El paquete de migraciones para pegar en el editor SQL.
  if (SUPABASE_DIR) {
    const r = spawnSync(process.execPath, [join(out, "scripts", "build-all-migrations.mjs")], { cwd: out, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`build-all-migrations fallo:\n${r.stdout}${r.stderr}`);
  }

  return { removed, stripped, overlaid, depsRemoved };
}

// ---------------------------------------------------------------------------
// Control de historia: lo que la copia no puede contar del proyecto.
// ---------------------------------------------------------------------------
// Se revisa todo el texto de la copia (codigo y comentarios), salvo las migraciones
// (verify-student-schema ya las revisa con su propio control) y lo generado.
const HISTORY_SKIP = [
  /^supabase\//, // migraciones, seeds y config: su control es verify-student-schema
  /^package-lock\.json$/,
  /^public\//, // datos y archivos generados (embed.js sale de lib/embed, que si se revisa)
  /^scripts\/build-all-migrations\.mjs$/,
];

export const COPY_HISTORY_PATTERNS = [
  { name: "numero de migracion", re: /(?<![\w-])00\d{3}(?![\w-])/ },
  { name: "fecha", re: /\b\d{1,2}\/\d{1,2}\/(?:19|20)\d{2}\b/ },
  { name: "PR", re: /\bPR\s*#\s*\d+/ },
  { name: "nombre propio", re: /\bWendy\b/i },
  { name: "produccion", re: /producci[oó]n/i },
  {
    name: "modulo sacado",
    re: /\bFathom\b|\bEOD\b|\bcomisi[oó]n(?:es)?\b|\bfinanzas\b|\bformularios?\b|\bcontratos?\b|webhooks? entrantes?|\btareas?\b/i,
  },
];

// Frases que nombran algo parecido a un modulo y no lo son (se borran antes de buscar).
const HISTORY_SAFE = [
  /tareas? (?:de (?:la )?IA|en segundo plano|del sistema|programadas?|de fondo)/gi,
  /llamadas? de WhatsApp/gi,
  /formulario de (?:reserva|la agenda|agendamiento)/gi,
  /<form\b|\bform\b/gi,
  /tiene que ser la publica de produccion/gi, // mensaje de private.set_system_secret
];

/** Lo que encuentra el control de historia en la copia: [{ file, line, rule, text }]. */
export function findHistoryInCopy(out) {
  const hits = [];
  for (const rel of walkFiles(out)) {
    if (!TEXT.test(rel) || HISTORY_SKIP.some((re) => re.test(rel))) continue;
    const lines = readFileSync(join(out, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      const clean = HISTORY_SAFE.reduce((t, re) => t.replace(re, " "), line);
      for (const p of COPY_HISTORY_PATTERNS) {
        if (p.re.test(clean)) hits.push({ file: rel, line: i + 1, rule: p.name, text: line.trim().slice(0, 200) });
      }
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Controles sobre la copia.
// ---------------------------------------------------------------------------
function run(cmd, args, cwd, env = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}`, seconds: Math.round((Date.now() - started) / 1000) };
}

// Variables de mentira para que `next build` no corte por una que falta: el build no se
// conecta a nada (todas las paginas del panel son dinamicas).
const BUILD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "build-only",
  SUPABASE_SERVICE_ROLE_KEY: "build-only",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_TELEMETRY_DISABLED: "1",
};

/**
 * Corre los controles sobre la copia (que ya tiene node_modules enlazado). Cada uno devuelve
 * { name, ok, detail, seconds, log }. `only` limita a algunos (por nombre).
 */
export function runGates(out, { only, vitestArgs = [], logDir = `${out}-controles` } = {}) {
  const bin = (name) => join(out, "node_modules", ".bin", name);
  const results = [];
  const want = (name) => !only || only.includes(name);
  mkdirSync(logDir, { recursive: true });
  const save = (name, text) => {
    const file = join(logDir, `${name}.log`);
    writeFileSync(file, text);
    return file;
  };

  if (want("tsc")) {
    const r = run(bin("tsc"), ["--noEmit", "--incremental", "false", "-p", out], out);
    const errors = r.output.split("\n").filter((l) => /error TS/.test(l)).length;
    results.push({ name: "tsc", ok: r.status === 0 && errors === 0, detail: `${errors} errores`, seconds: r.seconds, log: save("tsc", r.output) });
  }
  if (want("eslint")) {
    const json = join(logDir, "eslint.json");
    const r = run(bin("eslint"), [".", "-f", "json", "-o", json], out);
    let errors = 0;
    let warnings = 0;
    try {
      for (const f of JSON.parse(readFileSync(json, "utf8"))) {
        errors += f.errorCount;
        warnings += f.warningCount;
      }
    } catch {
      errors = -1;
    }
    results.push({ name: "eslint", ok: errors === 0, detail: `${errors} errores, ${warnings} avisos`, seconds: r.seconds, log: save("eslint", r.output) });
  }
  if (want("vitest")) {
    const r = run(bin("vitest"), ["run", ...vitestArgs], out);
    const files = /Test Files\s+(.*)/.exec(r.output)?.[1]?.trim() ?? "?";
    const tests = /Tests\s+(.*)/.exec(r.output.split("Test Files").pop() ?? "")?.[1]?.trim() ?? "?";
    results.push({ name: "vitest", ok: r.status === 0, detail: `archivos: ${files}; tests: ${tests}`, seconds: r.seconds, log: save("vitest", r.output) });
  }
  if (want("build")) {
    const r = run(bin("next"), ["build"], out, BUILD_ENV);
    results.push({ name: "build", ok: r.status === 0, detail: r.status === 0 ? "ok" : "fallo", seconds: r.seconds, log: save("build", r.output) });
  }
  if (want("historia")) {
    const started = Date.now();
    const hits = findHistoryInCopy(out);
    const text = hits.map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`).join("\n");
    const byRule = {};
    for (const h of hits) byRule[h.rule] = (byRule[h.rule] ?? 0) + 1;
    const detail = hits.length ? Object.entries(byRule).map(([k, v]) => `${k}: ${v}`).join(", ") : "ninguna";
    results.push({ name: "historia", ok: hits.length === 0, detail, seconds: Math.round((Date.now() - started) / 1000), log: save("historia", text) });
  }
  return results;
}

/** Saca de la copia lo que dejaron los controles (.next, el enlace a node_modules). */
export function cleanGateArtifacts(out) {
  for (const rel of [".next", "node_modules", "tsconfig.tsbuildinfo", "next-env.d.ts"]) {
    rmSync(join(out, rel), { recursive: true, force: true });
  }
}

