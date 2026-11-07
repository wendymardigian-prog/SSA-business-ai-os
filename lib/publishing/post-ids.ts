/**
 * Completar el `postIds` de una automatizacion al publicar (F39).
 *
 * Una automatizacion por comentario se puede limitar a posts puntuales
 * (`triggers.config.postIds`). El problema del huevo y la gallina: cuando se
 * arma el flow, el post todavia no existe y no hay id que pegar. Hasta ahora
 * eso se resolvia volviendo a entrar al flow despues de publicar, copiando el
 * id a mano.
 *
 * Con esto, publicar completa el id solo. Es lo UNICO que el modulo de
 * contenido le escribe al motor de automatizaciones.
 *
 * La decision de a que automatizacion le corresponde es pura y esta aca; se
 * apoya en `checkCta`, el mismo chequeo que muestra el editor, para que lo
 * que se completa sea exactamente lo que la pantalla prometio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { addPostId, checkCta, type AutomationRule, type NetworkCta } from "@/lib/content/keywords";

type Db = SupabaseClient<Database>;

export interface PostIdPlan {
  triggerId: string;
  /** El flujo de esa fila: el id tambien se escribe en su disparador del lienzo. */
  flowId?: string;
  postIds: string[];
}

/**
 * Los nodos del flujo con el `postIds` nuevo en su disparador de comentario. El lienzo es el dueno de las filas de
 * `triggers` (republicar las arma de nuevo desde el nodo): sin esto, el id que se completo en la fila se perdia en la
 * proxima publicacion. Devuelve null si no hay un disparador de comentario que tocar.
 */
export function withNodePostIds(nodes: unknown, postIds: string[]): unknown[] | null {
  if (!Array.isArray(nodes)) return null;
  let touched = false;
  const next = nodes.map((node) => {
    const n = node as { type?: unknown; data?: Record<string, unknown> } | null;
    if (n?.type !== "trigger" || n.data?.triggerType !== "comment_keyword") return node;
    touched = true;
    return { ...n, data: { ...n.data, postIds } };
  });
  return touched ? next : null;
}

/**
 * Que automatizacion hay que completar, y con que lista.
 *
 * Devuelve null cuando no hay nada que hacer, que es lo normal: la mayoria
 * de las automatizaciones valen para cualquier post y no se tocan.
 */
export function planPostId(params: {
  cta: NetworkCta | null | undefined;
  platform: string;
  channelId: string | null;
  rules: AutomationRule[];
  externalPostId: string | null;
}): PostIdPlan | null {
  if (!params.externalPostId || !params.cta) return null;

  const check = checkCta(params.cta, {
    platform: params.platform,
    channelId: params.channelId,
    rules: params.rules,
  });
  if (!check?.match) return null;

  const rule = params.rules.find((r) => r.triggerId === check.match!.triggerId);
  // Una automatizacion sin limite de posts responde a todos: agregarle el id
  // la limitaria a este, que es lo contrario de lo que esta configurado.
  if (!rule || rule.postIds.length === 0) return null;

  const postIds = addPostId(rule.postIds, params.externalPostId);
  if (postIds.length === rule.postIds.length) return null;

  return { triggerId: rule.triggerId, flowId: rule.flowId, postIds };
}

/** Las automatizaciones del workspace, en la forma que espera `planPostId`. */
export async function loadAutomationRules(supabase: Db, workspaceId: string): Promise<AutomationRule[]> {
  const { data } = await supabase
    .from("triggers")
    .select("id, flow_id, type, is_active, channel_id, config, flows(name)")
    .eq("workspace_id", workspaceId)
    .in("type", ["comment_keyword", "keyword"]);

  return (data ?? []).map((row) => {
    const config = (row.config ?? {}) as {
      keywords?: Array<{ value?: string; matchType?: string }>;
      postIds?: string[];
    };
    const flow = row.flows as unknown as { name?: string } | null;
    return {
      triggerId: row.id,
      flowId: row.flow_id,
      flowName: flow?.name ?? "",
      type: row.type,
      isActive: row.is_active,
      channelIds: row.channel_id ? [row.channel_id] : [],
      keywords: (config.keywords ?? []).map((k) => ({
        value: String(k.value ?? ""),
        matchType: k.matchType,
      })),
      postIds: Array.isArray(config.postIds) ? config.postIds : [],
    };
  });
}

/**
 * Completa el id del post recien publicado en la automatizacion que lo espera.
 *
 * Best-effort: si falla, la publicacion ya salio y no se toca. Queda en el
 * log y se puede completar a mano, que es lo que se hacia antes.
 */
export async function completePostIds(
  supabase: Db,
  params: {
    workspaceId: string;
    platform: string;
    channelId: string | null;
    cta: NetworkCta | null | undefined;
    externalPostId: string | null;
  },
): Promise<boolean> {
  try {
    const rules = await loadAutomationRules(supabase, params.workspaceId);
    const plan = planPostId({ ...params, rules });
    if (!plan) return false;

    const { data: trigger } = await supabase
      .from("triggers")
      .select("config")
      .eq("id", plan.triggerId)
      .maybeSingle();

    const config = { ...((trigger?.config ?? {}) as Record<string, unknown>), postIds: plan.postIds };
    const { error } = await supabase
      .from("triggers")
      .update({ config: config as Json })
      .eq("id", plan.triggerId);

    if (error) {
      console.error("[publishing] no pude completar el postId:", error.message);
      return false;
    }

    // El mismo id en el disparador del lienzo (y en su borrador, si hay uno): asi sobrevive a republicar.
    if (plan.flowId) {
      const { data: flow } = await supabase.from("flows").select("nodes, draft_nodes").eq("id", plan.flowId).maybeSingle();
      const row = flow as { nodes?: unknown; draft_nodes?: unknown } | null;
      const nodes = withNodePostIds(row?.nodes, plan.postIds);
      const draft = withNodePostIds(row?.draft_nodes, plan.postIds);
      if (nodes || draft) {
        const { error: flowError } = await supabase
          .from("flows")
          .update({ ...(nodes ? { nodes: nodes as Json } : {}), ...(draft ? { draft_nodes: draft as Json } : {}) })
          .eq("id", plan.flowId);
        if (flowError) console.error("[publishing] no pude completar el postId en el lienzo:", flowError.message);
      }
    }
    return true;
  } catch (err) {
    console.error("[publishing] no pude completar el postId:", err);
    return false;
  }
}
