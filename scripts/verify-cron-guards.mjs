#!/usr/bin/env node
/**
 * Verificacion de la guarda de los cron (00327, docs/crons.md).
 *
 * Corre contra la base real y prueba lo que Vitest no puede:
 *   1. private.cron_guard_decide da lo mismo que shouldCallCron sobre
 *      lib/cron/guard-decide.cases.json.
 *   2. Cada cron de lib/cron/guards.json llama a private.call_app_cron_if_work
 *      con su intervalo de seguridad; la purga de scheduled_jobs esta agendada y
 *      el historial de pg_cron se purga a 1 dia. Con --despues-de-00349: los
 *      cron de la misma frecuencia son UN trabajo (lib/cron/ticks.json), los
 *      viejos ya no estan, y una parte que falla no frena a las otras (se
 *      prueba forzando el error dentro de una transaccion que se deshace).
 *   3. La tabla de estado es UNLOGGED y nadie con sesion puede llamar a la guarda.
 *   4. La publicacion de Realtime tiene exactamente lib/realtime/tables.ts.
 *   5. Cada guarda dice "no hay trabajo" sin datos y "si hay" con el dato justo,
 *      tambien en el borde de cada umbral. Se prueba con una fecha del ano 2000
 *      (p_now): los datos reales son todos posteriores y no se ven.
 *   6. Lo que tarda cada guarda con los datos de hoy.
 *
 * No deja nada: los datos de prueba van en UNA transaccion que se deshace
 * (ROLLBACK) y nunca los ve la app. Por eso no hace falta el candado de los
 * otros verify-*. Mientras corre puede tener tomada unos segundos la fila del
 * carril de envios de un canal (el caso de send-queue).
 *
 *   node scripts/verify-cron-guards.mjs [--despues-de-00349]
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dbTargetArgs } from "./lib/db-target.mjs";

// Relativo a este archivo: la CLI corre con --linked desde la carpeta vinculada, que puede ser otra.
const repoFile = (path) => new URL(`../${path}`, import.meta.url);

let failures = 0;
let skipped = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

function sql(query) {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).rows ?? [];
}
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const guards = JSON.parse(readFileSync(repoFile("lib/cron/guards.json"), "utf8"));
const ticks = JSON.parse(readFileSync(repoFile("lib/cron/ticks.json"), "utf8"));
const after00349 = process.argv.includes("--despues-de-00349");
// Las partes que corren en la base (gemela de TICK_DB_PARTS en lib/cron/ticks.ts).
const TICK_DB_PARTS = { "agent-drafts-sweep": "private.sweep_agent_drafts", "draft-window-alerts": "private.alert_draft_windows" };
const decideCases = JSON.parse(readFileSync(repoFile("lib/cron/guard-decide.cases.json"), "utf8"));
const realtimeTables = [
  ...readFileSync(repoFile("lib/realtime/tables.ts"), "utf8").match(/REALTIME_TABLES = \[([\s\S]*?)\]/)[1].matchAll(/"([a-z_]+)"/g),
].map((m) => m[1]).sort();

try {
  // -------------------------------------------------------------------------
  console.log("\n1. La decision: SQL = TypeScript");
  {
    const values = decideCases.map((c) =>
      `(${lit(c.name)}, ${c.hasWork === null ? "NULL::boolean" : c.hasWork}, ${lit(c.lastCalledAt)}::timestamptz, ` +
      `${c.safetyMinutes === null ? "NULL::interval" : `make_interval(mins => ${c.safetyMinutes})`}, ${lit(c.now)}::timestamptz, ${c.expected})`,
    );
    const rows = sql(
      `SELECT name FROM (VALUES ${values.join(",")}) AS t(name, w, l, s, n, exp) ` +
        `WHERE private.cron_guard_decide(w, l, s, n) IS DISTINCT FROM exp`,
    );
    check(rows.length === 0, `cron_guard_decide da lo mismo en los ${decideCases.length} casos`, rows.map((r) => r.name).join("; "));
  }

  // -------------------------------------------------------------------------
  console.log("\n2. Los cron pasan por la guarda");
  {
    const jobs = sql(`SELECT jobname, schedule, command, active FROM cron.job`);
    const byName = new Map(jobs.map((j) => [j.jobname, j]));
    const inTick = new Set(ticks.flatMap((t) => t.parts));
    const guardCall = (g) => `private.call_app_cron_if_work('${g.path}', interval '${intervalText(g.safetyMinutes)}')`;
    for (const g of guards) {
      if (after00349 && inTick.has(g.path)) {
        check(!byName.has(g.path), `${g.path}: ya no tiene su propio cron (va en su trabajo agrupado)`, `en la base: ${byName.get(g.path)?.command}`);
        continue;
      }
      const expected = `SELECT ${guardCall(g)}`;
      check(byName.get(g.path)?.command === expected, `${g.path}: ${expected}`, `en la base: ${byName.get(g.path)?.command}`);
    }
    check(byName.get("purge-scheduled-jobs")?.command === "SELECT private.purge_scheduled_jobs(30, 90)", "la purga de scheduled_jobs esta agendada");
    check(byName.get("purge-cron-runs")?.command === "SELECT private.purge_cron_run_details(1)", "el historial de pg_cron se purga a 1 dia");

    if (after00349) {
      console.log("\n2b. Los cron agrupados (00349)");
      for (const t of ticks) {
        const j = byName.get(t.job);
        check(
          j?.schedule === t.schedule && j?.command === `SELECT ${t.sqlFunction}()` && j?.active === true,
          `${t.job}: '${t.schedule}', SELECT ${t.sqlFunction}()`,
          `en la base: ${j ? `${j.schedule} | ${j.command} | activo=${j.active}` : "no esta"}`,
        );
        for (const part of t.parts) {
          if (part in TICK_DB_PARTS) check(!byName.has(part), `${part}: ya no tiene su propio cron`, `en la base: ${byName.get(part)?.command}`);
        }
        const [def] = sql(`SELECT pg_get_functiondef(${lit(t.sqlFunction + "()")}::regprocedure) AS d`);
        for (const part of t.parts) {
          const g = guards.find((x) => x.path === part);
          const call = g ? guardCall(g) : `${TICK_DB_PARTS[part]}()`;
          check(def.d.includes(`PERFORM ${call};`) && def.d.includes(`cron_tick_note_error('${part}', SQLERRM)`), `${t.sqlFunction} corre ${part} en su bloque`);
        }
      }

      // Una parte que falla no frena a las otras. Se fuerza el error de la primera parte del trabajo de 5 minutos
      // (se reemplaza su funcion DENTRO de la transaccion, que se deshace: nadie mas la ve) y se mira que las
      // demas hayan corrido: las guardas anotan cada pasada en cron_guard_state (llamada o salteada).
      const t5 = ticks.find((t) => t.parts[0] === "agent-drafts-sweep");
      const later = t5.parts.filter((p) => !(p in TICK_DB_PARTS));
      const counts = `(SELECT coalesce(sum(called_count + skipped_count), 0) FROM private.cron_guard_state WHERE path IN (${later.map(lit).join(", ")}))`;
      const [r] = sql(
        [
          "BEGIN",
          "SET LOCAL lock_timeout = '5s'",
          `CREATE TEMP TABLE zz_tick AS SELECT ${counts} AS before`,
          `CREATE OR REPLACE FUNCTION private.sweep_agent_drafts() RETURNS jsonb LANGUAGE plpgsql SET search_path TO '' AS $zz$ BEGIN RAISE EXCEPTION 'zz-test-cron-tick: falla forzada'; END $zz$`,
          `SELECT ${t5.sqlFunction}()`,
          `SELECT (SELECT before FROM zz_tick) AS before, ${counts} AS after,
                  (SELECT last_error FROM private.cron_tick_errors WHERE part = 'agent-drafts-sweep') AS noted`,
          "ROLLBACK",
        ].join(";\n") + ";",
      );
      check(String(r?.noted ?? "").includes("zz-test-cron-tick"), "el error de una parte queda en cron_tick_errors", `anotado: ${r?.noted}`);
      check(
        Number(r?.after) - Number(r?.before) === later.length,
        `las otras partes corrieron igual (${later.join(", ")})`,
        `pasadas por la guarda: antes ${r?.before}, despues ${r?.after}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  console.log("\n3. El estado y los permisos");
  {
    const [r] = sql(`
      SELECT (SELECT relpersistence::text FROM pg_class WHERE oid = 'private.cron_guard_state'::regclass) AS persistence,
             has_function_privilege('anon', 'private.call_app_cron_if_work(text,interval)', 'execute') AS anon_exec,
             has_function_privilege('authenticated', 'private.call_app_cron_if_work(text,interval)', 'execute') AS auth_exec,
             has_function_privilege('authenticated', 'private.cron_has_work(text,timestamptz)', 'execute') AS auth_has_work,
             has_table_privilege('authenticated', 'private.cron_guard_state', 'select') AS auth_state`);
    if (after00349) {
      const [t] = sql(`
        SELECT (SELECT relpersistence::text FROM pg_class WHERE oid = 'private.cron_tick_errors'::regclass) AS persistence,
               bool_or(has_function_privilege(r, f, 'execute')) AS someone_exec,
               has_table_privilege('authenticated', 'private.cron_tick_errors', 'select') AS auth_errors
        FROM unnest(ARRAY['anon', 'authenticated']) AS r,
             unnest(ARRAY[${ticks.map((x) => lit(x.sqlFunction + "()")).join(", ")}, 'private.cron_tick_note_error(text,text)']) AS f`);
      check(t.persistence === "u", "private.cron_tick_errors es UNLOGGED (no escribe WAL)", `relpersistence = ${t.persistence}`);
      check(t.someone_exec === false, "ni anon ni authenticated pueden correr los trabajos agrupados");
      check(t.auth_errors === false, "authenticated no lee los errores de los cron");
    }
    check(r.persistence === "u", "private.cron_guard_state es UNLOGGED (no escribe WAL)", `relpersistence = ${r.persistence}`);
    check(r.anon_exec === false && r.auth_exec === false && r.auth_has_work === false, "ni anon ni authenticated pueden llamar a la guarda");
    check(r.auth_state === false, "authenticated no lee el estado de la guarda");
  }

  // -------------------------------------------------------------------------
  console.log("\n4. Realtime publica exactamente lo que escucha la interfaz");
  {
    const rows = sql(`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' ORDER BY 1`);
    const published = rows.map((r) => r.tablename).sort();
    check(JSON.stringify(published) === JSON.stringify(realtimeTables), "supabase_realtime = lib/realtime/tables.ts",
      `en la base: ${published.join(", ")} | en el codigo: ${realtimeTables.join(", ")}`);
  }

  // -------------------------------------------------------------------------
  console.log("\n5. Cada guarda, con y sin el dato justo (fecha de prueba: 1/1/2000, todo en una transaccion que se deshace)");
  {
    const rows = sql(fixtureScript());
    for (const r of rows) {
      if (r.err) {
        fail(`${r.path}: ${r.name} (no se pudo armar el caso)`, r.err);
        continue;
      }
      if (Number(r.present) === 0) {
        console.log(`  --    ${r.name}: no hay datos de base para armar el caso (se saltea)`);
        skipped++;
        continue;
      }
      check(r.got === r.expected, `${r.path}: ${r.name} -> ${r.expected ? "hay trabajo" : "no hay trabajo"}`, `la guarda dijo ${r.got}`);
    }
    check(rows.length > 0, "el bloque de casos devolvio resultados");
  }

  // -------------------------------------------------------------------------
  console.log("\n6. Lo que tarda cada guarda hoy");
  {
    const paths = guards.map((g) => lit(g.path)).join(", ");
    const rows = sql(`
      WITH t AS (
        SELECT p, clock_timestamp() AS t0, private.cron_has_work(p, now()) AS work, clock_timestamp() AS t1
        FROM unnest(ARRAY[${paths}]) AS p
      )
      SELECT p, work, round(extract(epoch FROM t1 - t0) * 1000, 1) AS ms FROM t`);
    for (const r of rows) check(Number(r.ms) < 100, `${r.p}: ${r.ms} ms (hoy ${r.work ? "hay" : "no hay"} trabajo)`);
  }
} catch (err) {
  fail("la verificacion se corto", err instanceof Error ? err.message : String(err));
}

console.log(
  failures === 0
    ? `\nTodo en verde${skipped ? ` (${skipped} caso(s) salteado(s) por falta de datos de base)` : ""}.`
    : `\n${failures} comprobacion(es) fallaron.`,
);
process.exit(failures === 0 ? 0 : 1);

// ---------------------------------------------------------------------------

function intervalText(minutes) {
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 day" : `${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** Los casos: cada uno arma su dato, pregunta a la guarda y lo deshace. */
function fixtureScript() {
  const T = "TIMESTAMPTZ '2000-01-01 00:00:00+00'";
  const at = (offset) => `${T} + interval '${offset}'`;
  const KEY = "'zz-test-cron-guard'";
  const job = (type, status, runAt, claimedAt) =>
    `INSERT INTO public.scheduled_jobs (type, status, run_at, claimed_at, dedupe_key) VALUES ('${type}', '${status}', ${at(runAt)}, ${claimedAt === null ? "NULL" : at(claimedAt)}, ${KEY})`;
  const jobPresent = `(SELECT count(*) FROM public.scheduled_jobs WHERE dedupe_key = ${KEY})`;

  const run = (created) =>
    `INSERT INTO public.agent_runs (workspace_id, source, trigger, status, created_at) SELECT r.ws, 'agent', 'inbound_message', 'running', ${at(created)} FROM zz_ref r WHERE r.ws IS NOT NULL`;
  const runPresent = `(SELECT count(*) FROM public.agent_runs WHERE created_at < ${at("1 day")})`;

  const knowledge = (deleted) =>
    `INSERT INTO public.knowledge_base (workspace_id, title, deleted_at) SELECT r.ws, 'zz-test-cron-guard', ${at(deleted)} FROM zz_ref r WHERE r.ws IS NOT NULL`;
  const knowledgePresent = `(SELECT count(*) FROM public.knowledge_base WHERE title = 'zz-test-cron-guard')`;

  const event = (processed) =>
    `INSERT INTO public.automation_events (workspace_id, event_type, source_type, created_at, processed_at) SELECT r.ws, 'contact_created', 'system', ${at("-1 minute")}, ${processed ? at("0 seconds") : "NULL"} FROM zz_ref r WHERE r.ws IS NOT NULL`;
  const eventPresent = `(SELECT count(*) FROM public.automation_events WHERE created_at < ${at("1 day")})`;

  const broadcast = (status, scheduledFor) =>
    `INSERT INTO public.broadcasts (workspace_id, name, status, scheduled_for, channel_id, created_at) SELECT r.channel_ws, 'zz-test-cron-guard', '${status}', ${scheduledFor === null ? "NULL" : at(scheduledFor)}, r.channel, ${at("-1 hour")} FROM zz_ref r WHERE r.channel IS NOT NULL`;
  const broadcastPresent = `(SELECT count(*) FROM public.broadcasts WHERE name = 'zz-test-cron-guard')`;
  const lane = (nextSend, paused) =>
    `INSERT INTO public.channel_send_lanes (channel_id, workspace_id, next_send_at, paused_at) SELECT r.channel, r.channel_ws, ${at(nextSend)}, ${paused ? at("-1 minute") : "NULL"} FROM zz_ref r WHERE r.channel IS NOT NULL ` +
    `ON CONFLICT (channel_id) DO UPDATE SET next_send_at = EXCLUDED.next_send_at, paused_at = EXCLUDED.paused_at`;
  const recipient = (claimed) =>
    `${broadcast("draft", null)}; INSERT INTO public.broadcast_recipients (broadcast_id, contact_id, channel_id, status, claimed_at) ` +
    `SELECT b.id, r.contact, r.channel, 'sending', ${at(claimed)} FROM zz_ref r JOIN public.broadcasts b ON b.name = 'zz-test-cron-guard' WHERE r.contact IS NOT NULL`;
  const recipientPresent = `(SELECT count(*) FROM public.broadcast_recipients WHERE claimed_at < ${at("1 day")})`;

  const enrollment = (locked) =>
    `INSERT INTO public.sequence_enrollments (sequence_id, contact_id, channel_id, status, next_step_at, locked_at) ` +
    `SELECT s.id, r.contact, r.channel, 'active', ${at("-1 minute")}, ${locked === null ? "NULL" : at(locked)} FROM zz_ref r CROSS JOIN LATERAL (SELECT id FROM public.sequences LIMIT 1) s ` +
    `WHERE r.contact IS NOT NULL AND r.channel IS NOT NULL ON CONFLICT DO NOTHING`;
  const enrollmentPresent = `(SELECT count(*) FROM public.sequence_enrollments WHERE next_step_at < ${at("1 day")})`;

  const draft =
    `INSERT INTO public.agent_drafts (workspace_id, conversation_id, contact_id, channel_id, status, body, created_at) ` +
    `SELECT c.workspace_id, c.id, c.contact_id, c.channel_id, 'pending', 'zz-test-cron-guard', ${at("-1 minute")} FROM zz_ref r JOIN public.conversations c ON c.id = r.free_conversation`;
  const draftPresent = `(SELECT count(*) FROM public.agent_drafts WHERE created_at < ${at("1 day")})`;

  const transcript = (started) =>
    `UPDATE public.messages SET transcript_status = 'pending', transcript_started_at = ${at(started)} WHERE id = (SELECT r.message FROM zz_ref r)`;
  const transcriptPresent = `(SELECT count(*) FROM public.messages WHERE transcript_started_at < ${at("1 day")})`;

  const cases = [
    // agent-bursts
    ["agent-bursts", "turno vencido hace 1 minuto", true, job("agent_burst", "pending", "-1 minute", null), jobPresent],
    ["agent-bursts", "turno para dentro de 3 s (la guarda mira 5 s adelante)", true, job("agent_burst", "pending", "3 seconds", null), jobPresent],
    ["agent-bursts", "turno para dentro de 1 minuto", false, job("agent_burst", "pending", "1 minute", null), jobPresent],
    ["agent-bursts", "turno trabado hace 7 minutos", true, job("agent_burst", "processing", "-10 minutes", "-7 minutes"), jobPresent],
    ["agent-bursts", "turno reclamado hace 5 minutos (todavia no esta trabado)", false, job("agent_burst", "processing", "-10 minutes", "-5 minutes"), jobPresent],
    ["agent-bursts", "corrida de IA abierta hace 11 minutos", true, run("-11 minutes"), runPresent],
    ["agent-bursts", "corrida de IA abierta hace 9 minutos", false, run("-9 minutes"), runPresent],
    // jobs
    ["jobs", "job vencido", true, job("resume_flow", "pending", "-1 minute", null), jobPresent],
    ["jobs", "un turno del agente no es de esta cola", false, job("agent_burst", "pending", "-1 minute", null), jobPresent],
    ["jobs", "una subida larga no es de esta cola", false, job("content_upload", "pending", "-1 minute", null), jobPresent],
    ["jobs", "reclamado sin fecha de reclamo", true, job("resume_flow", "processing", "-1 minute", null), jobPresent],
    ["jobs", "reclamado hace 4 minutos", false, job("resume_flow", "processing", "-10 minutes", "-4 minutes"), jobPresent],
    ["jobs", "reclamado hace 6 minutos", true, job("resume_flow", "processing", "-10 minutes", "-6 minutes"), jobPresent],
    ["jobs", "documento borrado hace 31 dias", true, knowledge("-31 days"), knowledgePresent],
    ["jobs", "documento borrado hace 29 dias", false, knowledge("-29 days"), knowledgePresent],
    ["jobs", "transcripcion colgada hace 11 minutos", true, transcript("-11 minutes"), transcriptPresent],
    ["jobs", "transcripcion empezada hace 9 minutos", false, transcript("-9 minutes"), transcriptPresent],
    // content-upload
    ["content-upload", "agendado en el proveedor, vencido", true, job("content_provider_schedule", "pending", "-1 minute", null), jobPresent],
    ["content-upload", "un job comun no es de esta cola", false, job("resume_flow", "pending", "-1 minute", null), jobPresent],
    ["content-upload", "subida reclamada hace 11 minutos", true, job("content_upload", "processing", "-20 minutes", "-11 minutes"), jobPresent],
    ["content-upload", "subida reclamada hace 9 minutos", false, job("content_upload", "processing", "-20 minutes", "-9 minutes"), jobPresent],
    // automation-events
    ["automation-events", "evento sin procesar", true, event(false), eventPresent],
    ["automation-events", "evento ya procesado", false, event(true), eventPresent],
    // send-queue
    ["send-queue", "broadcast programado cuya hora llego", true, broadcast("scheduled", "-1 minute"), broadcastPresent],
    ["send-queue", "broadcast programado para dentro de 1 minuto", false, broadcast("scheduled", "1 minute"), broadcastPresent],
    ["send-queue", "enviandose con el carril listo", true, `${broadcast("sending", null)}; ${lane("-1 minute", false)}`, broadcastPresent],
    ["send-queue", "enviandose con el carril en pausa", false, `${broadcast("sending", null)}; ${lane("-1 minute", true)}`, broadcastPresent],
    ["send-queue", "enviandose con el carril esperando 1 minuto", false, `${broadcast("sending", null)}; ${lane("1 minute", false)}`, broadcastPresent],
    ["send-queue", "destinatario en sending hace 6 minutos", true, recipient("-6 minutes"), recipientPresent],
    ["send-queue", "destinatario en sending hace 4 minutos", false, recipient("-4 minutes"), recipientPresent],
    // sequences
    ["sequences", "paso vencido sin reclamar", true, enrollment(null), enrollmentPresent],
    ["sequences", "paso reclamado hace 4 minutos", false, enrollment("-4 minutes"), enrollmentPresent],
    ["sequences", "paso reclamado hace 6 minutos", true, enrollment("-6 minutes"), enrollmentPresent],
    // drafts-refresh
    ["drafts-refresh", "borrador pendiente", true, draft, draftPresent],
  ];

  const paths = guards.map((g) => lit(g.path)).join(", ");
  const parts = [
    "BEGIN",
    "CREATE TEMP TABLE zz_res (name text, path text, expected boolean, got boolean, present bigint, err text)",
    `CREATE TEMP TABLE zz_ref AS SELECT
       (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1) AS ws,
       (SELECT id FROM public.contacts WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1) AS contact,
       (SELECT id FROM public.channels ORDER BY created_at LIMIT 1) AS channel,
       (SELECT workspace_id FROM public.channels ORDER BY created_at LIMIT 1) AS channel_ws,
       (SELECT c.id FROM public.conversations c
         WHERE NOT EXISTS (SELECT 1 FROM public.agent_drafts d WHERE d.conversation_id = c.id AND d.status IN ('pending', 'sending', 'failed'))
         ORDER BY c.created_at LIMIT 1) AS free_conversation,
       (SELECT id FROM public.messages ORDER BY created_at LIMIT 1) AS message`,
    // Sin datos de prueba, nada.
    `INSERT INTO zz_res SELECT 'sin datos de prueba', p, false, private.cron_has_work(p, ${T}), 1, NULL FROM unnest(ARRAY[${paths}]) AS p`,
  ];
  // Cada caso en su bloque: arma el dato, pregunta, y lo deshace con una excepcion propia (ZZ001). Las variables
  // sobreviven a la excepcion; si el armado falla por otra cosa, queda anotado y los demas casos siguen.
  for (const [path, name, expected, setup, present] of cases) {
    parts.push(`DO $zz$
DECLARE v_got boolean; v_present bigint; v_err text;
BEGIN
  BEGIN
    ${setup};
    v_got := private.cron_has_work(${lit(path)}, ${T});
    v_present := ${present};
    RAISE EXCEPTION USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN SQLSTATE 'ZZ001' THEN NULL;
    WHEN OTHERS THEN v_err := SQLERRM;
  END;
  INSERT INTO zz_res VALUES (${lit(name)}, ${lit(path)}, ${expected}, v_got, v_present, v_err);
END $zz$`);
  }
  parts.push("SELECT name, path, expected, got, present, err FROM zz_res", "ROLLBACK");
  return parts.join(";\n") + ";";
}
