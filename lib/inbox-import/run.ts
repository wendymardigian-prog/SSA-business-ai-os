/**
 * Arrancar y avanzar la importacion de conversaciones de un canal de Zernio (00267).
 *
 * Dos piezas:
 *
 * - `startInboxImport`: arma una corrida nueva y encola su primera vuelta. La llaman
 *   guardar la clave de Zernio, "Sincronizar canales", una cuenta conectada desde
 *   Zernio y las pasadas de 24 horas y 7 dias.
 * - `runInboxImportStep`: una vuelta del trabajo `inbox_import`. Lee hasta
 *   `PAGES_PER_STEP` paginas, guarda el avance y encola la vuelta siguiente (o la
 *   espera de un reintento, o la pasada que sigue).
 *
 * Las reglas (cuando seguir, esperar o terminar) estan en `./state.ts`, que es puro.
 * Aca solo se habla con la base, con Zernio y con la cola.
 *
 * Ninguna de las dos lanza por un fallo de Zernio: la cola reintentaria a los 10
 * segundos encima de la espera propia (1, 5 y 15 minutos). Un error de la base si
 * lanza: la cola lo reintenta y, si sigue, el trabajo queda fallido a la vista.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import type { Zernio } from "@/lib/zernio-client";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioKeyState, type ZernioKeyState } from "@/lib/integrations/zernio-key";
import { isTemporaryZernioStatus, zernioStatus } from "@/lib/publishing/zernio-errors";
import { scheduleJob } from "@/lib/scheduler";
import { importInboxPage } from "@/lib/inbox-sync";
import {
  afterFailure,
  afterPage,
  canStartImport,
  newImportState,
  PAGE_SIZE,
  PAGES_PER_STEP,
  parseImportState,
  passForManualStart,
  type ImportPass,
  type InboxImportState,
  type NextAction,
} from "./state";

type Db = SupabaseClient<Database>;

/** Una vuelta de la importacion de un canal. */
export const INBOX_IMPORT_JOB = "inbox_import";
/** Arranca la pasada de 24 horas o la de 7 dias. */
export const INBOX_IMPORT_PASS_JOB = "inbox_import_pass";

export interface InboxImportStepPayload {
  workspaceId: string;
  channelId: string;
  runId: string;
  step: number;
}

export interface InboxImportPassPayload {
  workspaceId: string;
  channelId: string;
  pass: ImportPass;
}

/** Lo que se puede reemplazar en los tests. */
export interface ImportDeps {
  now?: () => Date;
  keyState?: (workspaceId: string, service: Db) => Promise<ZernioKeyState>;
  createClient?: (apiKey: string) => Zernio;
  schedule?: typeof scheduleJob;
  newRunId?: () => string;
}

interface ChannelRow {
  id: string;
  workspace_id: string;
  late_account_id: string;
  platform: string;
  provider: string;
  is_active: boolean;
  inbox_import: unknown;
}

async function loadChannel(service: Db, workspaceId: string, channelId: string): Promise<ChannelRow | null> {
  const { data, error } = await service
    .from("channels")
    .select("id, workspace_id, late_account_id, platform, provider, is_active, inbox_import")
    .eq("id", channelId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`no pude leer el canal ${channelId}: ${error.message}`);
  return (data as ChannelRow | null) ?? null;
}

export type StartResult =
  | { started: true; runId: string; pass: ImportPass }
  | { started: false; reason: "not_found" | "inactive" | "not_zernio" | "running" | "queue" };

/**
 * Arma una corrida nueva y encola su primera vuelta.
 *
 * `pass: "auto"` es la de "Sincronizar canales": la primera si el canal nunca se
 * importo, una suelta si ya se importo. Si ya hay una corrida en marcha no se arma
 * otra (dos clics a "Sincronizar" darian dos importaciones); una corrida colgada,
 * sin novedades hace media hora, si se reemplaza.
 *
 * El workspace lo pone quien llama, sacado de la sesion o del trabajo: nunca del pedido.
 */
export async function startInboxImport(
  service: Db,
  target: { workspaceId: string; channelId: string },
  options: { pass: ImportPass | "auto" },
  deps: ImportDeps = {},
): Promise<StartResult> {
  const now = (deps.now ?? (() => new Date()))();
  const schedule = deps.schedule ?? scheduleJob;

  const channel = await loadChannel(service, target.workspaceId, target.channelId);
  if (!channel) return { started: false, reason: "not_found" };
  if (!channel.is_active) return { started: false, reason: "inactive" };
  if (channel.provider !== "zernio") return { started: false, reason: "not_zernio" };

  const current = parseImportState(channel.inbox_import);
  if (!canStartImport(current, now)) return { started: false, reason: "running" };

  const pass = options.pass === "auto" ? passForManualStart(current) : options.pass;
  const runId = (deps.newRunId ?? randomUUID)();
  const state = newImportState(pass, runId, now);

  await writeState(service, channel.id, state);

  try {
    await schedule(
      service,
      INBOX_IMPORT_JOB,
      { workspaceId: channel.workspace_id, channelId: channel.id, runId, step: 0 } satisfies InboxImportStepPayload,
      now,
      stepKey(channel.id, runId, 0),
    );
  } catch (err) {
    console.error(`[inbox-import] no pude encolar la importacion del canal ${channel.id}:`, errorText(err));
    await writeState(service, channel.id, {
      ...state,
      status: "error",
      finished_at: now.toISOString(),
      last_error: "No pude poner la importación en la cola. Probá de nuevo en un rato.",
    });
    return { started: false, reason: "queue" };
  }

  return { started: true, runId, pass };
}

/**
 * Arranca la importacion en varios canales del mismo workspace (Sincronizar
 * canales, guardar la clave). Nunca lanza: un canal que falla se anota y sigue.
 */
export async function startInboxImports(
  service: Db,
  workspaceId: string,
  channelIds: string[],
  pass: ImportPass | "auto",
  deps: ImportDeps = {},
): Promise<{ started: number; running: number }> {
  let started = 0;
  let running = 0;
  for (const channelId of channelIds) {
    try {
      const result = await startInboxImport(service, { workspaceId, channelId }, { pass }, deps);
      if (result.started) started += 1;
      else if (result.reason === "running") running += 1;
    } catch (err) {
      console.error(`[inbox-import] no pude arrancar la importacion del canal ${channelId}:`, errorText(err));
    }
  }
  return { started, running };
}

export type StepOutcome =
  | "channel_gone"
  | "superseded"
  | "no_key"
  | "continued"
  | "waiting"
  | "finished";

/** Una vuelta del trabajo `inbox_import`. */
export async function runInboxImportStep(
  service: Db,
  payload: InboxImportStepPayload,
  deps: ImportDeps = {},
): Promise<StepOutcome> {
  const clock = deps.now ?? (() => new Date());
  const schedule = deps.schedule ?? scheduleJob;

  const channel = await loadChannel(service, payload.workspaceId, payload.channelId);
  if (!channel || !channel.is_active || channel.provider !== "zernio") return "channel_gone";

  const loaded = parseImportState(channel.inbox_import);
  // Otra corrida la reemplazo, otra vuelta ya avanzo este paso, o ya termino: no se sigue.
  if (!loaded || loaded.run_id !== payload.runId || loaded.step !== payload.step || loaded.status !== "running") {
    return "superseded";
  }

  const key = await (deps.keyState ?? ((ws, db) => getZernioKeyState(ws, { supabase: db as never })))(
    channel.workspace_id,
    service,
  );

  let state: InboxImportState = loaded;
  let next: NextAction;

  if (key.state === "absent") {
    // Sin clave no hay que esperar: no va a aparecer sola.
    ({ state, next } = afterFailure(
      state,
      { temporary: false, message: "Falta la clave de Zernio. Cargala en Integraciones y tocá Reintentar." },
      clock(),
    ));
  } else if (key.state === "unknown") {
    // No se pudo leer Vault: eso si se arregla esperando.
    ({ state, next } = afterFailure(
      state,
      { temporary: true, message: "No pude leer la clave de Zernio. Se reintenta sola." },
      clock(),
    ));
  } else {
    const zernio = (deps.createClient ?? createZernioClient)(key.key);
    next = { kind: "page" };
    for (let i = 0; i < PAGES_PER_STEP && next.kind === "page"; i++) {
      try {
        const page = await importInboxPage({
          service: service as unknown as SupabaseClient,
          zernio,
          workspaceId: channel.workspace_id,
          channel: { id: channel.id, late_account_id: channel.late_account_id, platform: channel.platform },
          phase: state.phase,
          cursor: state.cursor,
          pageSize: PAGE_SIZE,
        });
        if (page.accountFailure) {
          // Zernio avisa que la cuenta fallo de su lado: suele ser pasajero
          // (Meta limitando), asi que se espera como un 429.
          ({ state, next } = afterFailure(
            state,
            { temporary: true, message: `Zernio no pudo leer esta cuenta: ${page.accountFailure}` },
            clock(),
          ));
        } else {
          ({ state, next } = afterPage(state, page, clock()));
        }
      } catch (err) {
        const status = zernioStatus(err);
        ({ state, next } = afterFailure(state, describeZernioFailure(status), clock()));
        console.error(`[inbox-import] canal ${channel.id}: Zernio fallo (${status ?? "sin codigo"}): ${errorText(err)}`);
      }
    }
  }

  const advanced: InboxImportState = { ...state, step: loaded.step + 1 };
  const won = await writeStateIfCurrent(service, channel.id, advanced, loaded);
  if (!won) return "superseded";

  const now = clock();
  if (next.kind === "page" || next.kind === "wait") {
    const runAt = next.kind === "wait" ? next.runAt : now;
    await schedule(
      service,
      INBOX_IMPORT_JOB,
      {
        workspaceId: channel.workspace_id,
        channelId: channel.id,
        runId: advanced.run_id,
        step: advanced.step,
      } satisfies InboxImportStepPayload,
      runAt,
      stepKey(channel.id, advanced.run_id, advanced.step),
    );
    return next.kind === "wait" ? "waiting" : "continued";
  }

  if (next.followUp) await scheduleFollowUp(service, schedule, channel, next.followUp);
  if (key.state === "absent") return "no_key";
  console.log(
    `[inbox-import] canal ${channel.id}: pasada ${advanced.pass} ${advanced.status}, ` +
      `${advanced.scanned} miradas, ${advanced.imported} nuevas`,
  );
  return "finished";
}

/**
 * Una pasada programada (24 horas o 7 dias). Si en ese momento hay otra corrida en
 * marcha (alguien toco "Sincronizar"), se corre una hora: perderla dejaria afuera lo
 * que Zernio termino de traer tarde.
 */
export async function runInboxImportPass(
  service: Db,
  payload: InboxImportPassPayload,
  deps: ImportDeps = {},
): Promise<StartResult> {
  const result = await startInboxImport(
    service,
    { workspaceId: payload.workspaceId, channelId: payload.channelId },
    { pass: payload.pass },
    deps,
  );
  if (!result.started && result.reason === "running") {
    const runAt = new Date((deps.now ?? (() => new Date()))().getTime() + 60 * 60_000);
    await scheduleFollowUpRaw(service, deps.schedule ?? scheduleJob, payload, runAt);
  }
  return result;
}

/** El texto en simple de un fallo de Zernio, y si se arregla esperando. */
export function describeZernioFailure(status: number | undefined): { temporary: boolean; message: string } {
  if (status === undefined) {
    return { temporary: true, message: "No pude comunicarme con Zernio. Se reintenta sola." };
  }
  if (status === 401 || status === 403) {
    return {
      temporary: false,
      message: `Zernio rechazó la clave (código ${status}). Revisala en Integraciones y tocá Reintentar.`,
    };
  }
  if (isTemporaryZernioStatus(status)) {
    return { temporary: true, message: `Zernio no respondió (código ${status}). Se reintenta sola.` };
  }
  return { temporary: false, message: `Zernio rechazó el pedido (código ${status}). Tocá Reintentar.` };
}

function stepKey(channelId: string, runId: string, step: number): string {
  return `${INBOX_IMPORT_JOB}:${channelId}:${runId}:${step}`;
}

async function scheduleFollowUp(
  service: Db,
  schedule: typeof scheduleJob,
  channel: ChannelRow,
  followUp: { pass: ImportPass; runAt: Date },
): Promise<void> {
  await scheduleFollowUpRaw(
    service,
    schedule,
    { workspaceId: channel.workspace_id, channelId: channel.id, pass: followUp.pass },
    followUp.runAt,
  );
}

async function scheduleFollowUpRaw(
  service: Db,
  schedule: typeof scheduleJob,
  payload: InboxImportPassPayload,
  runAt: Date,
): Promise<void> {
  try {
    await schedule(
      service,
      INBOX_IMPORT_PASS_JOB,
      { ...payload } satisfies InboxImportPassPayload,
      runAt,
      `${INBOX_IMPORT_PASS_JOB}:${payload.channelId}:${payload.pass}`,
    );
  } catch (err) {
    // 23505: ya hay una pendiente para esta pasada. Es lo que se busca.
    if ((err as { code?: string } | null)?.code !== "23505") {
      console.error(`[inbox-import] no pude agendar la pasada ${payload.pass} del canal ${payload.channelId}:`, errorText(err));
    }
  }
}

async function writeState(service: Db, channelId: string, state: InboxImportState): Promise<void> {
  const { error } = await service
    .from("channels")
    .update({ inbox_import: state as unknown as Json })
    .eq("id", channelId);
  if (error) throw new Error(`no pude guardar el avance de la importacion: ${error.message}`);
}

/**
 * Guarda el avance SOLO si nadie lo cambio desde que se leyo (misma corrida, mismo
 * paso). Si una vuelta repetida por la cola o una corrida nueva ganaron, esta no
 * escribe ni encola nada: asi no se arman dos cadenas para el mismo canal.
 */
async function writeStateIfCurrent(
  service: Db,
  channelId: string,
  state: InboxImportState,
  expected: InboxImportState,
): Promise<boolean> {
  const { data, error } = await service
    .from("channels")
    .update({ inbox_import: state as unknown as Json })
    .eq("id", channelId)
    .eq("inbox_import->>run_id", expected.run_id)
    .eq("inbox_import->>step", String(expected.step))
    .select("id");
  if (error) throw new Error(`no pude guardar el avance de la importacion: ${error.message}`);
  return (data ?? []).length > 0;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
