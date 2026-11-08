import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import cases from "./guard-decide.cases.json";
import { CRON_GUARDS, UNGUARDED_CRONS, shouldCallCron } from "./guards";
import { CRON_TICKS, TICK_DB_PARTS } from "./ticks";
import { lastFunctionDefinition, listMigrations, readMigration, stripSqlComments } from "@/lib/test-utils/migrations";
import { AGENT_BURST_JOB } from "@/lib/scheduler";
import { CONTENT_UPLOAD_JOB, SLOW_JOB_TYPES } from "@/lib/content/jobs";

/**
 * La guarda de los cron (00327) copia en SQL lo que mira cada handler de
 * app/api/cron. Una guarda que se saltea una condicion deja trabajo sin hacer
 * hasta la llamada de seguridad, sin ningun error. Estos tests la atan al codigo:
 *
 * 1. La decision (llamar o no) da lo mismo en SQL y en TypeScript.
 * 2. La lista de cron con guarda y sus intervalos es la de la migracion.
 * 3. Cada umbral del SQL sale de la constante del codigo.
 * 4. Si un handler suma un barrido, una tabla o una funcion, el test falla
 *    hasta que alguien revise la guarda.
 */

const root = join(__dirname, "..", "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("la decision de llamar (gemela de private.cron_guard_decide)", () => {
  it.each(cases)("$name", (c) => {
    expect(
      shouldCallCron({
        hasWork: c.hasWork,
        lastCalledAt: c.lastCalledAt ? new Date(c.lastCalledAt) : null,
        safetyMs: c.safetyMinutes == null ? null : c.safetyMinutes * 60_000,
        now: new Date(c.now),
      }),
    ).toBe(c.expected);
  });

  it("la version SQL decide con las mismas cuatro reglas", () => {
    const sql = lastFunctionDefinition("private.cron_guard_decide")?.sql ?? "";
    expect(sql).toContain("p_has_work IS DISTINCT FROM false THEN true");
    expect(sql).toContain("p_last_called_at IS NULL OR p_safety IS NULL OR p_now IS NULL THEN true");
    expect(sql).toContain("p_last_called_at > p_now THEN true");
    expect(sql).toContain("p_last_called_at <= p_now - p_safety");
  });
});

/**
 * Con que intervalo llama cada cron a la guarda, leido de los comandos de los cron. Desde la 00349 los que corren
 * con la misma frecuencia van en un solo trabajo (`private.cron_tick_*`, lib/cron/ticks.json): sus guardas se leen
 * de la ULTIMA definicion de esa funcion. Los demas siguen con su propio cron, en dos formas: la lista `VALUES` de
 * la 00327 y el comando literal (`call_app_cron_if_work('jobs', interval '10 minutes')`), que es como lo escriben
 * las migraciones de la plantilla, generadas desde la base.
 */
function scheduledGuards(): Map<string, { safety: string; via: string }> {
  const found = new Map<string, { safety: string; via: string }>();
  const inTick = new Set(CRON_TICKS.flatMap((t) => t.parts));
  const guardCalls = (sql: string) => sql.matchAll(/call_app_cron_if_work\('([a-z-]+)',\s*interval\s*'([^']+)'\)/g);
  for (const file of listMigrations()) {
    const sql = stripSqlComments(readMigration(file));
    const direct: Array<[string, string]> = [];
    if (sql.includes("call_app_cron_if_work(%L, interval %L)")) {
      const values = /FROM\s*\(\s*VALUES([\s\S]*?)\)\s*AS\s+v\(path,\s*safety\)/i.exec(sql);
      for (const m of values?.[1].matchAll(/\('([a-z-]+)',\s*'([^']+)'\)/g) ?? []) direct.push([m[1], m[2]]);
    }
    for (const m of guardCalls(sql)) direct.push([m[1], m[2]]);
    // Lo que paso a un trabajo agrupado ya no tiene su propio cron (la 00349 lo saca): se lee de ese trabajo, abajo.
    for (const [path, safety] of direct) if (!inTick.has(path)) found.set(path, { safety, via: path });
  }
  for (const tick of CRON_TICKS) {
    const body = lastFunctionDefinition(tick.sqlFunction)?.sql ?? "";
    for (const m of guardCalls(body)) found.set(m[1], { safety: m[2], via: tick.job });
  }
  if (found.size === 0) throw new Error("ninguna migracion hace pasar los cron por call_app_cron_if_work");
  return found;
}

function intervalMinutes(text: string): number {
  const m = /^(\d+)\s+(minute|minutes|hour|hours|day|days)$/.exec(text.trim());
  if (!m) throw new Error(`intervalo que el test no entiende: ${text}`);
  const n = Number(m[1]);
  return m[2].startsWith("minute") ? n : m[2].startsWith("hour") ? n * 60 : n * 24 * 60;
}

describe("los cron con guarda", () => {
  it("son los de CRON_GUARDS, con los mismos intervalos de seguridad", () => {
    const scheduled = scheduledGuards();
    expect([...scheduled.keys()].sort()).toEqual(CRON_GUARDS.map((g) => g.path).sort());
    for (const g of CRON_GUARDS) expect(intervalMinutes(scheduled.get(g.path)!.safety), g.path).toBe(g.safetyMinutes);
  });

  it("la llamada de seguridad es mas larga que el periodo del cron (si no, nunca se saltearia)", () => {
    // El periodo de un trabajo agrupado sale de ticks.json; el de los que siguen con su propio cron, de la 00036 y siguientes.
    const ownCron: Record<string, number> = { "content-upload": 2, inactivity: 15, "bg-collect": 15 };
    for (const g of CRON_GUARDS) {
      const period = CRON_TICKS.find((t) => t.parts.includes(g.path))?.periodMinutes ?? ownCron[g.path];
      expect(period, `${g.path}: falta su periodo`).toBeGreaterThan(0);
      expect(g.safetyMinutes, g.path).toBeGreaterThan(period * 2);
    }
  });

  it("cada ruta de private.call_app_cron tiene guarda o un motivo para no tenerla", () => {
    const body = lastFunctionDefinition("private.call_app_cron")?.sql ?? "";
    const list = /p_path NOT IN \(([\s\S]*?)\)/.exec(body);
    const routes = [...(list?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    const covered = [...CRON_GUARDS.map((g) => g.path), ...Object.keys(UNGUARDED_CRONS)].sort();
    expect(covered).toEqual(routes);
  });

  it("private.cron_has_work despacha cada ruta a su funcion", () => {
    const sql = lastFunctionDefinition("private.cron_has_work")?.sql ?? "";
    for (const g of CRON_GUARDS) expect(sql, g.path).toContain(`WHEN '${g.path}' THEN ${g.sqlFunction}(p_now)`);
  });

  it("private.call_app_cron no se reescribio: la guarda la envuelve", () => {
    const wrapper = lastFunctionDefinition("private.call_app_cron_if_work")?.sql ?? "";
    expect(wrapper).toContain("RETURN private.call_app_cron(p_path)");
    expect(lastFunctionDefinition("private.call_app_cron")?.file).not.toMatch(/^00327_/);
  });
});

// ---------------------------------------------------------------------------
// Los cron agrupados (00349): un trabajo por frecuencia, cada parte en su bloque.
// ---------------------------------------------------------------------------

/** El ultimo `cron.schedule('<trabajo>', '<horario>', '<comando>')` de cada trabajo (comillas simples o `$$`). */
function lastSchedule(job: string): { schedule: string; command: string } | null {
  let found: { schedule: string; command: string } | null = null;
  const name = job.replace(/[-]/g, "\\-");
  const re = new RegExp(`cron\\.schedule\\(\\s*'${name}',\\s*'([^']+)',\\s*(?:'((?:[^']|'')*)'|\\$(\\w*)\\$([\\s\\S]*?)\\$\\3\\$)\\s*\\)`, "g");
  for (const file of listMigrations()) {
    for (const m of stripSqlComments(readMigration(file)).matchAll(re)) {
      found = { schedule: m[1], command: (m[2] ?? m[4]).replace(/''/g, "'").trim() };
    }
  }
  return found;
}

describe("los cron agrupados (un trabajo de pg_cron por frecuencia)", () => {
  it("cada parte esta en un solo trabajo, y cada una es una guarda o un cron de la base", () => {
    const parts = CRON_TICKS.flatMap((t) => t.parts);
    expect(new Set(parts).size).toBe(parts.length);
    const guarded = new Set(CRON_GUARDS.map((g) => g.path));
    for (const p of parts) expect(guarded.has(p) || p in TICK_DB_PARTS, `${p}: ni guarda ni cron de la base`).toBe(true);
    for (const p of Object.keys(TICK_DB_PARTS)) expect(parts, p).toContain(p);
  });

  it.each(CRON_TICKS)("$job se agenda con su horario y llama a $sqlFunction", (tick) => {
    expect(lastSchedule(tick.job)).toEqual({ schedule: tick.schedule, command: `SELECT ${tick.sqlFunction}()` });
  });

  it.each(CRON_TICKS)("$sqlFunction corre cada parte en su bloque, en orden, y anota su error", (tick) => {
    const sql = lastFunctionDefinition(tick.sqlFunction)?.sql ?? "";
    expect(sql, `${tick.sqlFunction} no existe en las migraciones`).not.toBe("");
    // Un bloque por parte, mas el del cuerpo: si dos partes compartieran bloque, una que falla frenaria a la otra.
    expect(sql.match(/\bBEGIN\b/g)?.length, tick.sqlFunction).toBe(tick.parts.length + 1);
    expect(sql.match(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/g)?.length, tick.sqlFunction).toBe(tick.parts.length);
    const safety = new Map(CRON_GUARDS.map((g) => [g.path, g.safetyMinutes]));
    let from = 0;
    for (const part of tick.parts) {
      const call = part in TICK_DB_PARTS ? `PERFORM ${TICK_DB_PARTS[part]}()` : `PERFORM private.call_app_cron_if_work('${part}', interval `;
      const block = new RegExp(
        `BEGIN\\s*${call.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^;]*;\\s*EXCEPTION\\s+WHEN\\s+OTHERS\\s+THEN\\s*` +
          `PERFORM private\\.cron_tick_note_error\\('${part}', SQLERRM\\);\\s*END;`,
      );
      const m = block.exec(sql.slice(from));
      expect(m, `${tick.sqlFunction}: la parte ${part} no esta sola en su bloque, o no va en este orden`).not.toBeNull();
      from += m!.index + m![0].length;
      if (safety.has(part)) expect(sql).toContain(`call_app_cron_if_work('${part}', interval '`);
    }
  });

  it("la anotacion del error nunca lanza (si no, una parte que falla tumbaria la corrida entera)", () => {
    const sql = lastFunctionDefinition("private.cron_tick_note_error")?.sql ?? "";
    expect(sql).toMatch(/BEGIN\s*INSERT INTO private\.cron_tick_errors[\s\S]*EXCEPTION WHEN OTHERS THEN\s*RAISE WARNING/);
  });

  it("el de cada 5 minutos no arranca en el minuto 0 (ahi arrancan los de cada 10 y 15)", () => {
    const tick = CRON_TICKS.find((t) => t.periodMinutes === 5)!;
    expect(tick.schedule).not.toMatch(/^(\*|0)[\s/]/);
  });
});

// ---------------------------------------------------------------------------
// Cada umbral del SQL sale de una constante del codigo.
// ---------------------------------------------------------------------------

type Unit = "ms" | "minutes" | "days" | "hours";
interface Threshold {
  what: string;
  file: string;
  /** Captura la expresion numerica de la constante (`6 * 60_000`, `30`, ...). */
  pattern: RegExp;
  unit: Unit;
  sqlFunction: string;
  /** Como tiene que aparecer en el SQL, a partir del valor en minutos (o dias/horas). */
  sql: (value: number) => string;
}

const minutesInterval = (n: number) => `interval '${n} minutes'`;

const THRESHOLDS: Threshold[] = [
  { what: "turno trabado", file: "app/api/cron/agent-bursts/route.ts", pattern: /const STALE_CLAIM_MS = ([\d_ *]+);/, unit: "ms", sqlFunction: "private.cron_work_agent_bursts", sql: minutesInterval },
  { what: "corrida de IA abierta", file: "lib/ai/run.ts", pattern: /olderThanMinutes = (\d+)/, unit: "minutes", sqlFunction: "private.cron_work_agent_bursts", sql: minutesInterval },
  { what: "destinatario en sending", file: "lib/send-queue/dispatch.ts", pattern: /export const STALE_SENDING_MS = ([\d_ *]+);/, unit: "ms", sqlFunction: "private.cron_work_send_queue", sql: minutesInterval },
  { what: "subida reclamada", file: "app/api/cron/content-upload/route.ts", pattern: /const STALE_CLAIM_MS = ([\d_ *]+);/, unit: "ms", sqlFunction: "private.cron_work_content_upload", sql: minutesInterval },
  { what: "job reclamado", file: "app/api/cron/jobs/route.ts", pattern: /const STALE_INVOCATION_MS = ([\d_ *]+);/, unit: "ms", sqlFunction: "private.cron_work_jobs", sql: minutesInterval },
  { what: "documento borrado", file: "app/api/cron/jobs/route.ts", pattern: /const RETENTION_DAYS = (\d+);/, unit: "days", sqlFunction: "private.cron_work_jobs", sql: (n) => `interval '${n} days'` },
  { what: "publicacion colgada", file: "lib/publishing/sweep.ts", pattern: /export const STUCK_AFTER_MINUTES = (\d+);/, unit: "minutes", sqlFunction: "private.cron_work_jobs", sql: minutesInterval },
  { what: "publicacion por conciliar", file: "lib/publishing/reconcile.ts", pattern: /export const RECONCILE_AFTER_MINUTES = (\d+);/, unit: "minutes", sqlFunction: "private.cron_work_jobs", sql: minutesInterval },
  { what: "transcripcion colgada", file: "lib/chat-media/transcribe-message.ts", pattern: /export const STUCK_TRANSCRIPT_MS = ([\d_ *]+);/, unit: "ms", sqlFunction: "private.cron_work_jobs", sql: minutesInterval },
  { what: "cierre: dias hacia atras", file: "lib/agent/closing.ts", pattern: /export const SWEEP_MAX_AGE_DAYS = (\d+);/, unit: "days", sqlFunction: "private.cron_work_jobs", sql: (n) => `p_now - interval '${n} days'` },
  { what: "cierre: horas por defecto", file: "lib/agent/config.ts", pattern: /closeAfterInactiveHours: row\.close_after_inactive_hours \?\? (\d+)/, unit: "hours", sqlFunction: "private.cron_work_jobs", sql: (n) => `COALESCE(a.close_after_inactive_hours, ${n})` },
  { what: "envio recibido sin procesar", file: "lib/webhooks/reaper.ts", pattern: /export const RECEIVED_STALE_MS = ([\d_ *]+);/, unit: "ms", sqlFunction: "private.cron_work_jobs_extra", sql: minutesInterval }, // @plantilla-quitar(webhooks)
  { what: "envio procesandose", file: "lib/webhooks/reaper.ts", pattern: /export const PROCESSING_STALE_MS = ([\d_ *]+);/, unit: "ms", sqlFunction: "private.cron_work_jobs_extra", sql: minutesInterval }, // @plantilla-quitar(webhooks)
];

/** `6 * 60_000` -> 360000. Solo numeros y multiplicaciones: lo que usan estas constantes. */
function evaluate(expr: string): number {
  return expr
    .split("*")
    .map((part) => Number(part.trim().replace(/_/g, "")))
    .reduce((a, b) => a * b, 1);
}

describe("cada umbral de la guarda es el del codigo", () => {
  it.each(THRESHOLDS)("$what ($file)", (t) => {
    const match = t.pattern.exec(read(t.file));
    expect(match, `no encontre la constante en ${t.file}: si se renombro, actualiza THRESHOLDS`).not.toBeNull();
    const raw = evaluate(match![1]);
    const value = t.unit === "ms" ? raw / 60_000 : raw;
    expect(Number.isInteger(value), `${t.what}: ${raw} ${t.unit} no es un numero entero de minutos`).toBe(true);
    const sql = lastFunctionDefinition(t.sqlFunction)?.sql ?? "";
    expect(sql, `${t.sqlFunction} tiene que usar ${t.sql(value)} (${t.what})`).toContain(t.sql(value));
  });

  it("la cola de jobs excluye los mismos tipos que el handler", () => {
    const route = read("app/api/cron/jobs/route.ts");
    expect(route).toContain('.neq("type", AGENT_BURST_JOB)');
    expect(route).toContain('.neq("type", CONTENT_UPLOAD_JOB)');
    const sql = lastFunctionDefinition("private.cron_work_jobs")?.sql ?? "";
    expect(sql.match(new RegExp(`j\\.type NOT IN \\('${AGENT_BURST_JOB}', '${CONTENT_UPLOAD_JOB}'\\)`, "g"))?.length).toBe(2);
  });

  it("las subidas largas son los SLOW_JOB_TYPES", () => {
    const sql = lastFunctionDefinition("private.cron_work_content_upload")?.sql ?? "";
    const list = `(${SLOW_JOB_TYPES.map((t) => `'${t}'`).join(", ")})`;
    expect(sql.match(new RegExp(`j\\.type IN ${list.replace(/[()]/g, "\\$&")}`, "g"))?.length).toBe(2);
  });

  it("los turnos del agente son los de AGENT_BURST_JOB", () => {
    const sql = lastFunctionDefinition("private.cron_work_agent_bursts")?.sql ?? "";
    expect(sql.match(new RegExp(`j\\.type = '${AGENT_BURST_JOB}'`, "g"))?.length).toBe(2);
  });

  it("las secuencias usan el mismo vencimiento que claim_sequence_enrollments", () => {
    const claim = lastFunctionDefinition("public.claim_sequence_enrollments")?.sql ?? "";
    expect(claim).toMatch(/p_stale_after interval DEFAULT '5 minutes'/);
    expect(lastFunctionDefinition("private.cron_work_sequences")?.sql).toContain("interval '5 minutes'");
  });
});

// ---------------------------------------------------------------------------
// La alarma: lo que llama cada handler. Si aparece un barrido nuevo, falla.
// ---------------------------------------------------------------------------

interface EntryPoint {
  file: string;
  fn: string;
  /** Las funciones que se esperan con `await` adentro. */
  calls: string[];
  /** Las tablas de `.from("...")` y las funciones de `.rpc("...")`. */
  tables: string[];
}

const ENTRY_POINTS: Record<string, EntryPoint[]> = {
  "agent-bursts": [
    { file: "app/api/cron/agent-bursts/route.ts", fn: "GET", calls: ["closeStaleRuns", "createServiceClient", "expireStuckJobs", "markAgentError", "runAgentTurn"], tables: ["scheduled_jobs"] },
  ],
  "send-queue": [
    { file: "app/api/cron/send-queue/route.ts", fn: "GET", calls: ["createServiceClient", "runSendQueue"], tables: [] },
    { file: "lib/send-queue/dispatch.ts", fn: "runSendQueue", calls: ["activateScheduled", "reapStaleSending", "runLane"], tables: ["broadcasts"] },
    { file: "lib/send-queue/dispatch.ts", fn: "runLane", calls: ["deferLane", "deliver", "emailSendCapacity", "laneCounts", "loadBroadcastChannel", "pauseLane", "pickBroadcast"], tables: ["broadcast_recipients", "channel_send_lanes", "claim_broadcast_recipient", "claim_lane_slot", "refresh_broadcast_counts", "workspaces"] },
  ],
  "automation-events": [
    { file: "app/api/cron/automation-events/route.ts", fn: "GET", calls: ["createServiceClient", "processEvent"], tables: ["automation_events", "bookings"] },
  ],
  sequences: [
    { file: "app/api/cron/sequences/route.ts", fn: "GET", calls: ["processSequenceSteps"], tables: [] },
    { file: "lib/sequences/processor.ts", fn: "processSequenceSteps", calls: ["createServiceClient", "loadBlockedContacts", "pause", "processEnrollment", "release", "reschedule"], tables: ["claim_sequence_enrollments"] },
  ],
  "content-upload": [
    { file: "app/api/cron/content-upload/route.ts", fn: "GET", calls: ["createServiceClient", "handler"], tables: ["scheduled_jobs"] },
  ],
  jobs: [
    {
      file: "app/api/cron/jobs/route.ts",
      fn: "GET",
      calls: [
        "createServiceClient",
        "failJobAndSettleSession",
        "processJob",
        "purgeDeletedKnowledgeDocuments",
        "reapInboundWebhooks", // @plantilla-quitar(webhooks)
        "reapStuckTranscriptions",
        "reconcileProviderSchedules",
        "sweepInactiveConversations",
        "sweepStuckPublications",
      ],
      tables: ["scheduled_jobs", "webhook_events"],
    },
  ],
  "drafts-refresh": [
    { file: "app/api/cron/drafts-refresh/route.ts", fn: "GET", calls: ["checkRefreshHealth", "createServiceClient", "refreshPendingDrafts"], tables: ["workspaces"] },
  ],
  "whatsapp-health": [
    {
      file: "app/api/cron/whatsapp-health/route.ts",
      fn: "GET",
      calls: ["configFor", "createServiceClient", "getConnectionState", "getEvolutionConfig", "logAudit", "notifyWorkspaceAdmins", "refreshWhatsappIdentity"],
      tables: ["channels"],
    },
  ],
  inactivity: [
    { file: "app/api/cron/inactivity/route.ts", fn: "GET", calls: ["createServiceClient", "executeFlow"], tables: ["conversations", "trigger_fires", "triggers"] },
  ],
  "bg-collect": [{ file: "app/api/cron/bg-collect/route.ts", fn: "GET", calls: [], tables: [] }],
};

/** El cuerpo de una funcion de nivel superior: desde su `function` hasta la primera `}` de la columna 0. */
function functionBody(file: string, fn: string): string {
  const src = read(file);
  const head = new RegExp(`(?:export\\s+)?async\\s+function\\s+${fn}\\s*\\(`).exec(src);
  if (!head) throw new Error(`no encontre ${fn} en ${file}`);
  const rest = src.slice(head.index);
  const end = rest.search(/\n\}\n/);
  return end === -1 ? rest : rest.slice(0, end + 2);
}

const uniqueSorted = (items: Iterable<string>) => [...new Set(items)].sort();

describe("la alarma: lo que hace cada handler sigue siendo lo que mira su guarda", () => {
  it("cada cron con guarda tiene sus puntos de entrada", () => {
    expect(Object.keys(ENTRY_POINTS).sort()).toEqual(CRON_GUARDS.map((g) => g.path).sort());
  });

  for (const [path, entries] of Object.entries(ENTRY_POINTS)) {
    for (const entry of entries) {
      it(`${path}: ${entry.file} -> ${entry.fn}`, () => {
        const body = functionBody(entry.file, entry.fn);
        const calls = uniqueSorted([...body.matchAll(/await\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
        const tables = uniqueSorted([
          ...[...body.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]),
          ...[...body.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]),
        ]);
        const hint =
          `Cambio lo que hace el cron "${path}". Si suma trabajo nuevo (un barrido, una cola), sumalo a su guarda ` +
          `(${CRON_GUARDS.find((g) => g.path === path)?.sqlFunction}) en una migracion nueva, o anota por que lo cubre ` +
          `la llamada de seguridad (coveredBySafetyCall en lib/cron/guards.ts). Despues actualiza ENTRY_POINTS.`;
        expect(calls, hint).toEqual(uniqueSorted(entry.calls));
        expect(tables, hint).toEqual(uniqueSorted(entry.tables));
      });
    }
  }
});
