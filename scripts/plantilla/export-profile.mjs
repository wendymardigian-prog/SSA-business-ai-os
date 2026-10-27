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
//   6. Limpia los comentarios: les saca la historia del proyecto (clean-comments.mjs). Solo
//      comentarios; si el codigo de un archivo cambiara en un solo token, frena.
//   7. Saca del package.json los paquetes que son solo de un modulo excluido.
//   8. Vuelve a armar supabase/migrations/ALL_MIGRATIONS.sql.
//
// `runGates` corre los controles sobre la copia (con node_modules enlazado del repo):
// tsc, eslint, vitest, next build y el de historia (`findHistoryInCopy`). Devuelve un
// resultado por control; el que llama decide.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { hasMarkers, stripMarkers } from "./markers.mjs";
import { cleanSource, historyRefs } from "./clean-comments.mjs";
import { codeTokens, commentLanguage, findComments } from "./comments.mjs";

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

  // 6. La historia en los comentarios. Las migraciones de la plantilla ya vienen limpias y
  // public/ es generado (embed.js sale de lib/embed, que si se limpia).
  let commentsCleaned = 0;
  const commentWarnings = [];
  for (const rel of walkFiles(out)) {
    if (!commentLanguage(rel) || /^(public|supabase\/migrations)\//.test(rel)) continue;
    const p = join(out, rel);
    const text = readFileSync(p, "utf8");
    const { text: next, changed, warnings } = cleanSource(text, rel);
    for (const w of warnings) commentWarnings.push(`${rel}: ${w}`);
    if (next === text) continue;
    const before = codeTokens(text, rel);
    if (before && before.join("\u0000") !== codeTokens(next, rel).join("\u0000"))
      throw new Error(`La limpieza de comentarios cambio el codigo de ${rel}: no se escribe (revisar clean-comments.mjs).`);
    writeFileSync(p, next);
    commentsCleaned += changed;
  }

  // 7. Paquetes que son solo de un modulo excluido.
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

  // 8. El paquete de migraciones para pegar en el editor SQL.
  if (SUPABASE_DIR) {
    const r = spawnSync(process.execPath, [join(out, "scripts", "build-all-migrations.mjs")], { cwd: out, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`build-all-migrations fallo:\n${r.stdout}${r.stderr}`);
  }

  return { removed, stripped, overlaid, depsRemoved, commentsCleaned, commentWarnings };
}

// ---------------------------------------------------------------------------
// Control de historia: lo que la copia no puede contar del proyecto.
// ---------------------------------------------------------------------------
// FRENA el export (strict):
//   - en los comentarios del codigo: numeros de migracion, fechas, codigos de requerimiento
//     ("F87", "M10"), etapas del proyecto ("Fase 3", "Extra I", "Contenido v4", "PR #12"...) y
//     las palabras de los modulos que la plantilla no lleva (salvo MODULE_ALLOWLIST);
//   - en cualquier texto: un nombre propio y un numero de PR;
//   - en los .md y .json: numeros de migracion y fechas (salvo TEXT_ALLOWLIST).
// Se INFORMA sin frenar: lo mismo en el codigo que no es un comentario (strings, nombres de tests),
// que la limpieza no toca a proposito.
// Las migraciones (verify-student-schema ya las revisa con su propio control) y lo generado no se miran.
const HISTORY_SKIP = [
  /^supabase\/migrations\//,
  /^package-lock\.json$/,
  /^public\//, // datos y archivos generados (embed.js sale de lib/embed, que si se revisa)
  /^scripts\/build-all-migrations\.mjs$/,
];

const ANYWHERE = [
  { rule: "nombre propio", re: /\bWendy\b/i },
  { rule: "PR", re: /\bPR\s*#\s*\d+/ },
];

/**
 * Lo que nombra un modulo que la plantilla no lleva (en comentarios). Son nombres propios del
 * modulo (con mayuscula: "Ventas", "Tareas") o frases que solo existen en el (una "respuesta de
 * formulario", "la cobranza"): "formulario", "tarea", "llamada" o "contrato" sueltos tienen otros
 * sentidos (el formulario de la ficha, una tarea de IA, una llamada a la API, el contrato de una
 * funcion) y no se buscan.
 */
export const MODULE_WORDS = [
  /\bFathom\b/g,
  /\bLlamadas\b/g,
  /\bllamadas? de venta\b/gi,
  /\bEOD\b/g,
  /\breportes? (?:de|del) fin de d[ií]a\b/gi,
  /\breporte del d[ií]a\b/gi,
  /\bFormularios\b/g,
  /\brespuestas? (?:de|del|a) (?:un |una |su )?(?:formularios?|encuestas?)\b/gi,
  /\bencuestas?\b/gi,
  /\bcontratos? firmados?\b|\bfirm(?:a|ar) (?:de |del )?(?:un |el )?contrato\b|\bmodo Contrato\b|\bcopia firmada\b/gi,
  /\bVentas\b/g,
  /\bcobranza\b/gi,
  /\bmora\b/gi,
  /\bpagos\b/gi,
  /\bm[eé]todos? de pago\b/gi,
  /\bTareas\b/g,
  /\btareas? del equipo\b/gi,
  /\bcrear (?:una )?tarea\b/gi,
  /\bFinanzas\b/g,
  /\bContratos\b/g,
  /\bgastos\b/gi,
  /\bcomisi[oó]n(?:es)?\b/gi,
  /\bwebhooks? entrantes?\b/gi,
];

/**
 * Lo que se parece a un modulo sacado y no lo es. Cada entrada dice por que. `files` limita la
 * excepcion a esos archivos; sin `files` vale en toda la copia.
 */
export const MODULE_ALLOWLIST = [
  { re: /\bTareas? (?:de (?:la )?IA|en segundo plano|del sistema)\b/gi, why: "las tareas de IA del sistema (clasificar, resumir, transcribir) son de Agentes IA, no del modulo de Tareas" },
  { files: /^(lib\/ai-tasks|lib\/background|components\/agents|app\/\(dashboard\)\/dashboard\/agents|app\/\(dashboard\)\/dashboard\/settings\/background|app\/api\/cron\/bg-)/, re: /\bTareas\b/g, why: "en Agentes IA, \"Tareas\" es la seccion de las tareas de IA" },
  { re: /\bLlamadas? (?:de|por) WhatsApp\b/g, why: "las llamadas de WhatsApp (el aviso de Evolution) son de la bandeja, no del modulo de Llamadas" },
  { re: /\bgastos? de (?:la )?IA\b/gi, why: "el gasto de IA (topes de gasto), no el modulo de Finanzas" },
  { re: /\b(?:Ventas|Servicio|Equipo|Otros)(?:, (?:Ventas|Servicio|Equipo|Otros))+|\bVentas · \w+|"Ventas"/g, why: "las areas de la agenda (Ventas, Servicio, Equipo, Otros) son de la Agenda" },
  { re: /\bVentas(?= \([áa]rea)|[áa]reas? (?:de )?Ventas\b/g, why: "el área Ventas de la agenda" },
  { re: /«Ventas»/g, why: "la columna «Ventas» de la tabla de anuncios (Meta vs CRM) es del dashboard de anuncios" },
];
/** Excepciones de numeros y fechas en .md y .json: los archivos de migracion propios de la plantilla. */
export const TEXT_ALLOWLIST = [
  { files: /^(CLAUDE\.md|README\.md|\.claude\/commands\/setup\.md)$/, re: /\b000(?:0\d|1[0-7])(?:_[a-z_]+)?\b/g, why: "los archivos de migracion de la plantilla (00000 a 00016) y la proxima (00017)" },
];

const stripAllow = (text, rel, list) =>
  list.reduce((t, a) => (a.files && !a.files.test(rel) ? t : t.replace(a.re, " ")), text);

/** Las palabras de modulos sacados que tiene una linea de comentario (despues de las excepciones). */
export function moduleWordsIn(line, rel = "") {
  const clean = stripAllow(line, rel, MODULE_ALLOWLIST);
  return MODULE_WORDS.flatMap((re) => [...clean.matchAll(re)].map((m) => m[0]));
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/**
 * Lo que encuentra el control de historia en la copia: [{ file, line, rule, text, strict }].
 * `strict` = frena el export.
 */
export function findHistoryInCopy(out) {
  const hits = [];
  const push = (rel, line, rule, text, strict) => hits.push({ file: rel, line, rule, text: text.trim().slice(0, 200), strict });
  for (const rel of walkFiles(out)) {
    if (!TEXT.test(rel) || HISTORY_SKIP.some((re) => re.test(rel))) continue;
    const text = readFileSync(join(out, rel), "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const a of ANYWHERE) if (a.re.test(line)) push(rel, i + 1, a.rule, line, true);
    });
    if (commentLanguage(rel)) {
      let code = text;
      for (const c of findComments(text, rel).reverse()) {
        const body = text.slice(c.start, c.end);
        body.split("\n").forEach((l, k) => {
          const line = lineOf(text, c.start) + k;
          for (const h of historyRefs(l)) push(rel, line, h.rule, l, true);
          for (const w of moduleWordsIn(l, rel)) push(rel, line, `modulo sacado (${w.toLowerCase()})`, l, true);
        });
        code = code.slice(0, c.start) + body.replace(/[^\n]/g, " ") + code.slice(c.end);
      }
      // Lo que no es comentario: se informa.
      code.split("\n").forEach((l, i) => {
        for (const h of historyRefs(l)) push(rel, i + 1, `${h.rule} (fuera de comentarios)`, lines[i], false);
      });
    } else if (/\.(md|json)$/.test(rel)) {
      lines.forEach((l, i) => {
        const clean = stripAllow(l, rel, TEXT_ALLOWLIST);
        for (const h of historyRefs(clean)) {
          const strict = h.rule === "numero de migracion" || h.rule === "fecha";
          push(rel, i + 1, strict ? h.rule : `${h.rule} (texto)`, l, strict);
        }
      });
    }
  }
  return hits;
}

/**
 * El resumen del control de historia: { ok, detail, text }. `ok` = ninguna que frene. El texto
 * lista primero las que frenan y despues las que solo se informan.
 */
export function historyReport(hits, warnings = []) {
  const strict = hits.filter((h) => h.strict);
  const info = hits.filter((h) => !h.strict);
  const count = (list) => {
    const by = {};
    for (const h of list) {
      const rule = h.rule.replace(/ \(.*\)$/, "");
      by[rule] = (by[rule] ?? 0) + 1;
    }
    return Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ") || "ninguna";
  };
  const fmt = (h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`;
  const text = [
    `# Frenan el export (${strict.length})`,
    ...strict.map(fmt),
    "",
    `# Comentarios que la limpieza no pudo arreglar sola: reescribirlos en el proyecto (${warnings.length})`,
    ...warnings,
    "",
    `# Solo se informan: fuera de comentarios (strings, nombres de tests) (${info.length})`,
    ...info.map(fmt),
  ].join("\n");
  const ok = strict.length === 0 && warnings.length === 0;
  const detail = `${strict.length} que frenan (${count(strict)}); ${warnings.length} comentarios para reescribir; se informan ${info.length} fuera de comentarios`;
  return { ok, detail, text: text + "\n" };
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
    const report = historyReport(findHistoryInCopy(out));
    results.push({ name: "historia", ok: report.ok, detail: report.detail, seconds: Math.round((Date.now() - started) / 1000), log: save("historia", report.text) });
  }
  return results;
}

/** Saca de la copia lo que dejaron los controles (.next, el enlace a node_modules). */
export function cleanGateArtifacts(out) {
  for (const rel of [".next", "node_modules", "tsconfig.tsbuildinfo", "next-env.d.ts"]) {
    rmSync(join(out, rel), { recursive: true, force: true });
  }
}

