#!/usr/bin/env node
/**
 * Pone al dia el historial de migraciones de una base que se instalo ANTES de que la
 * plantilla juntara sus migraciones en unos pocos archivos (supabase/historial-migraciones.json
 * dice hasta cual). Se corre una sola vez, despues de traer esa actualizacion y antes de
 * `supabase db push`.
 *
 * No cambia ni una tabla ni un dato: solo la lista interna de Supabase que dice que
 * migraciones ya se aplicaron (supabase_migrations.schema_migrations). Saca de esa lista las
 * migraciones viejas que ya no estan como archivo y deja anotadas las nuevas (que crean lo
 * mismo que ya esta en la base). Nunca toca una migracion que no sea de la lista oficial
 * (por ejemplo, una propia del negocio).
 *
 *   node scripts/migraciones-compactadas.mjs              # solo mira y explica que haria
 *   node scripts/migraciones-compactadas.mjs --aplicar    # lo hace
 *
 * Por defecto mira el proyecto vinculado (`supabase link`). Para una base local:
 *   --local [--workdir=carpeta]
 *
 * Si la base se armo pegando ALL_MIGRATIONS.sql en el editor (sin la CLI, asi que no tiene
 * historial), hace falta decir que esa base ya tenia TODO hasta el corte:
 *   --base-pegada-al-dia
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Que hay que hacer con una base, mirando solo su historial. Puro.
 *
 * manifest: { corte, foto: string[], historicas: { version, name }[] }
 * remote:   versiones anotadas en la base (o null si no tiene la tabla del historial)
 * hasTables: si la base ya tiene el sistema instalado (aunque no tenga historial)
 * pastedUpToDate: la persona dijo que la base pegada estaba al dia hasta el corte
 *
 * Devuelve { status, revert, markApplied, missing, custom, message }.
 *   status: "nothing" | "fresh" | "behind" | "pasted_unknown" | "ready" | "done"
 */
export function planCompaction({ manifest, remote, hasTables, pastedUpToDate = false }) {
  const historic = manifest.historicas.map((h) => h.version);
  const historicSet = new Set(historic);
  const foto = manifest.foto;
  const fotoSet = new Set(foto);
  const remoteList = remote ?? [];
  const remoteSet = new Set(remoteList);
  const custom = remoteList.filter((v) => !historicSet.has(v) && !fotoSet.has(v)).sort();
  const empty = { revert: [], markApplied: [], missing: [], custom };

  const anyHistoricOnly = historic.some((v) => !fotoSet.has(v) && remoteSet.has(v));
  const anyHistoric = historic.some((v) => remoteSet.has(v));

  // Sin nada del sistema anotado.
  if (!anyHistoric) {
    if (!hasTables) {
      return { status: "fresh", ...empty, message: "La base esta vacia: `supabase db push` instala todo de cero. No hay nada que arreglar." };
    }
    if (!pastedUpToDate) {
      return {
        status: "pasted_unknown",
        ...empty,
        message:
          "La base ya tiene el sistema pero no tiene historial de migraciones (se armo pegando ALL_MIGRATIONS.sql). " +
          `Si esa base tenia TODO hasta la migracion ${manifest.corte}, volve a correr con --base-pegada-al-dia. ` +
          `Si no, primero hay que ponerla al dia con la version de la plantilla anterior a la consolidacion (tag v-historial-completo).`,
      };
    }
    return {
      status: "ready",
      revert: [],
      markApplied: foto.filter((v) => !remoteSet.has(v)),
      missing: [],
      custom,
      message: "Se anotan como aplicadas las migraciones consolidadas (crean lo mismo que ya esta en la base).",
    };
  }

  // Ya consolidada: no quedan viejas que no esten en la foto.
  if (!anyHistoricOnly) {
    const markApplied = foto.filter((v) => !remoteSet.has(v));
    if (!markApplied.length) {
      return { status: "done", ...empty, message: "El historial ya esta al dia con las migraciones consolidadas. No hay nada que hacer." };
    }
    return {
      status: "ready",
      revert: [],
      markApplied,
      missing: [],
      custom,
      message: "Faltan anotar algunas migraciones consolidadas (crean lo mismo que ya esta en la base).",
    };
  }

  // Tiene historia vieja: tiene que estar completa hasta el corte.
  const missing = historic.filter((v) => !remoteSet.has(v));
  if (missing.length) {
    const last = historic.filter((v) => remoteSet.has(v)).at(-1) ?? "ninguna";
    return {
      status: "behind",
      revert: [],
      markApplied: [],
      missing,
      custom,
      message:
        `A la base le faltan ${missing.length} migracion(es) anteriores a la consolidacion (la ultima aplicada es la ${last}; la primera que falta, la ${missing[0]}). ` +
        "Primero hay que traer la version de la plantilla anterior a la consolidacion (tag v-historial-completo), " +
        "aplicar sus migraciones con `supabase db push`, y recien despues traer la version nueva y correr esto de nuevo.",
    };
  }

  return {
    status: "ready",
    revert: historic.filter((v) => !fotoSet.has(v) && remoteSet.has(v)),
    markApplied: foto.filter((v) => !remoteSet.has(v)),
    missing: [],
    custom,
    message: "La base tiene todas las migraciones hasta el corte: se cambia solo su historial.",
  };
}

/** Divide una lista en tandas (la linea de comandos tiene un tope de largo). */
export function chunks(list, size = 80) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Lo que habla con la base (solo con la CLI de Supabase).
// ---------------------------------------------------------------------------

function targetArgs(argv) {
  const workdir = argv.find((a) => a.startsWith("--workdir="))?.slice("--workdir=".length);
  const out = argv.includes("--local") ? ["--local"] : ["--linked"];
  if (workdir) out.push("--workdir", workdir);
  return out;
}

function supabase(args) {
  return execFileSync("supabase", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function query(target, sql) {
  const out = supabase(["db", "query", ...target, "--agent=no", "-o", "json", sql]);
  return JSON.parse(out.slice(out.indexOf("[")));
}

function readRemote(target) {
  const exists = query(target, "select to_regclass('supabase_migrations.schema_migrations') is not null as ok")[0]?.ok;
  const versions = exists ? query(target, "select version from supabase_migrations.schema_migrations order by version").map((r) => r.version) : null;
  const hasTables = Boolean(query(target, "select to_regclass('public.workspaces') is not null as ok")[0]?.ok);
  return { versions, hasTables };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const manifestPath = join(root, "supabase", "historial-migraciones.json");
  if (!existsSync(manifestPath)) {
    console.log("Esta copia no tiene supabase/historial-migraciones.json: no hay nada que consolidar.");
    return 0;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const argv = process.argv.slice(2);
  const target = targetArgs(argv);
  const apply = argv.includes("--aplicar");

  let remote;
  try {
    remote = readRemote(target);
  } catch (error) {
    console.error("No se pudo leer el historial de la base con la CLI de Supabase.");
    console.error("Revisa que el proyecto este vinculado (`supabase link`) y que tengas sesion (`supabase login`).");
    console.error(String(error.stderr || error.message).trim());
    return 1;
  }

  const plan = planCompaction({
    manifest,
    remote: remote.versions,
    hasTables: remote.hasTables,
    pastedUpToDate: argv.includes("--base-pegada-al-dia"),
  });

  console.log(plan.message);
  if (plan.custom.length) {
    console.log(`\nMigraciones propias de esta base (no se tocan): ${plan.custom.join(", ")}`);
  }
  if (plan.status !== "ready") return plan.status === "behind" || plan.status === "pasted_unknown" ? 1 : 0;

  console.log(`\nSe sacan del historial ${plan.revert.length} migraciones viejas (ya no estan como archivo).`);
  console.log(`Se anotan como aplicadas ${plan.markApplied.length} migraciones consolidadas.`);
  console.log("Ninguna tabla ni dato cambia.");
  if (!apply) {
    console.log("\nNo se hizo nada todavia. Para hacerlo: node scripts/migraciones-compactadas.mjs --aplicar" + (target[0] === "--local" ? " --local" : ""));
    return 0;
  }

  for (const part of chunks(plan.revert)) supabase(["migration", "repair", "--status", "reverted", ...part, ...target]);
  for (const part of chunks(plan.markApplied)) supabase(["migration", "repair", "--status", "applied", ...part, ...target]);

  const after = planCompaction({ manifest, remote: readRemote(target).versions, hasTables: true });
  if (after.status !== "done") {
    console.error(`\nDespues de arreglar el historial, el estado no es el esperado (${after.status}). Mira \`supabase migration list\`.`);
    return 1;
  }
  console.log("\nListo: el historial quedo al dia. Ahora `supabase db push` aplica solo las migraciones nuevas.");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main());
}
