/**
 * Las variables `call.*` en el contexto de un flujo (F32). Solo servidor.
 *
 * `{{call.title}}`, `{{call.date}}`, `{{call.outcome}}`, `{{call.next_step}}`,
 * `{{call.closer_name}}`, `{{call.closer_score}}`, `{{call.lead_score}}`.
 *
 * Todo texto: un dato que falta queda vacio, asi un mensaje no muestra
 * `{{call.next_step}}` ni "null". Se arman una vez por evento y viajan en las
 * `variables` de la sesion, que es lo unico que sobrevive a una pausa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { humanize } from "@/lib/calls/format";
import { ideaDate } from "@/lib/calls/summary";

type Db = SupabaseClient<Database>;

export interface CallVariables {
  title: string;
  date: string;
  outcome: string;
  next_step: string;
  closer_name: string;
  closer_score: string;
  lead_score: string;
}

export const CALL_VARIABLE_KEYS: Array<keyof CallVariables> = ["title", "date", "outcome", "next_step", "closer_name", "closer_score", "lead_score"];

export function emptyCallVariables(): CallVariables {
  return Object.fromEntries(CALL_VARIABLE_KEYS.map((k) => [k, ""])) as unknown as CallVariables;
}

/** Arma las variables de una llamada ya leida. Pura. */
export function buildCallVariables(
  call: { title: string; recorded_at: string; outcome: string | null; closer_score: number | null; lead_score: number | null; nextStep: string | null },
  closerName: string | null,
  timeZone: string,
): CallVariables {
  return {
    title: call.title,
    date: ideaDate(call.recorded_at, timeZone),
    outcome: call.outcome ? humanize(call.outcome) : "",
    next_step: call.nextStep?.trim() ?? "",
    closer_name: closerName ?? "",
    closer_score: call.closer_score === null ? "" : String(call.closer_score),
    lead_score: call.lead_score === null ? "" : String(call.lead_score),
  };
}

/** Devuelve `{}` si la llamada ya no existe: mejor sin la variable que con un error en el flujo. */
export async function callContextVariables(db: Db, callId: string): Promise<Record<string, unknown>> {
  const { data: call } = await db
    .from("calls")
    .select("title, recorded_at, outcome, closer_score, lead_score, workspace_id, recorded_by_user_id, next_step:analysis->resultado->>proximo_paso")
    .eq("id", callId)
    .maybeSingle();
  if (!call) return {};

  const [{ data: workspace }, { data: members }] = await Promise.all([
    db.from("workspaces").select("timezone").eq("id", call.workspace_id).maybeSingle(),
    call.recorded_by_user_id ? db.rpc("workspace_member_profiles", { p_workspace_id: call.workspace_id }) : Promise.resolve({ data: null }),
  ]);
  const closer = (members ?? []).find((m) => m.user_id === call.recorded_by_user_id);
  const closerName = closer?.full_name || closer?.meta_name || null;

  return {
    call: buildCallVariables(
      { title: call.title, recorded_at: call.recorded_at, outcome: call.outcome, closer_score: call.closer_score, lead_score: call.lead_score, nextStep: (call as unknown as { next_step: string | null }).next_step },
      closerName,
      workspace?.timezone ?? "UTC",
    ),
  };
}
