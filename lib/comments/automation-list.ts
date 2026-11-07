/**
 * La pestana Comentarios (antes Growth): las automatizaciones de comentarios y como les fue. Puro: la pagina lee y esto
 * arma lo que se muestra. No escribe nada: todo se configura en el lienzo.
 */
import { scopeSummary } from "@/lib/flows/comment-scope";

export interface CommentTriggerRow {
  id: string;
  flow_id: string;
  channel_id: string | null;
  is_active: boolean;
  config: unknown;
  flow: { id: string; name: string; status: string } | null;
}

export interface CommentLogRow {
  matched_trigger_id: string | null;
  dm_sent: boolean;
  reply_sent: boolean;
}

export interface FailedStepRow {
  flow_id: string;
  reason: string | null;
}

export interface CommentAutomation {
  triggerId: string;
  flowId: string;
  flowName: string;
  published: boolean;
  active: boolean;
  keywords: string[];
  scope: string;
  /** Una regla vieja de Growth: con cuenta y sin la marca del lienzo. Republicar no la toca. */
  legacy: boolean;
  matched: number;
  dmSent: number;
  /** Comentarios que coincidieron y no recibieron el mensaje privado. */
  notSent: number;
  topFailure: string | null;
}

function keywordsOf(config: unknown): string[] {
  const list = (config as { keywords?: unknown } | null)?.keywords;
  if (!Array.isArray(list)) return [];
  return list
    .map((k) => (typeof k === "string" ? k : (k as { value?: unknown } | null)?.value))
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
}

export function buildCommentAutomations(args: {
  triggers: CommentTriggerRow[];
  channelNames: Record<string, string>;
  logs: CommentLogRow[];
  failures: FailedStepRow[];
}): CommentAutomation[] {
  const byTrigger = new Map<string, { matched: number; dmSent: number }>();
  for (const log of args.logs) {
    if (!log.matched_trigger_id) continue;
    const entry = byTrigger.get(log.matched_trigger_id) ?? { matched: 0, dmSent: 0 };
    entry.matched += 1;
    if (log.dm_sent) entry.dmSent += 1;
    byTrigger.set(log.matched_trigger_id, entry);
  }

  const failuresByFlow = new Map<string, Map<string, number>>();
  for (const f of args.failures) {
    if (!f.reason) continue;
    const reasons = failuresByFlow.get(f.flow_id) ?? new Map<string, number>();
    reasons.set(f.reason, (reasons.get(f.reason) ?? 0) + 1);
    failuresByFlow.set(f.flow_id, reasons);
  }

  return args.triggers
    .filter((t) => t.flow)
    .map((t) => {
      const config = (t.config ?? {}) as { postIds?: unknown; origin?: unknown };
      const stats = byTrigger.get(t.id) ?? { matched: 0, dmSent: 0 };
      const reasons = [...(failuresByFlow.get(t.flow_id) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1]);
      return {
        triggerId: t.id,
        flowId: t.flow_id,
        flowName: t.flow!.name,
        published: t.flow!.status === "published",
        active: t.is_active,
        keywords: keywordsOf(t.config),
        scope: scopeSummary({
          channelName: t.channel_id ? (args.channelNames[t.channel_id] ?? "Una cuenta desconectada") : null,
          postCount: Array.isArray(config.postIds) ? config.postIds.length : 0,
        }),
        legacy: !!t.channel_id && config.origin !== "canvas",
        matched: stats.matched,
        dmSent: stats.dmSent,
        notSent: Math.max(0, stats.matched - stats.dmSent),
        topFailure: reasons[0]?.[0] ?? null,
      };
    })
    .sort((a, b) => Number(b.published && b.active) - Number(a.published && a.active) || b.matched - a.matched || a.flowName.localeCompare(b.flowName));
}

/** El estado de una fila de la actividad reciente. */
export function commentLogStatus(log: { matched_trigger_id: string | null; dm_sent: boolean; error: string | null }): { label: string; tone: "ok" | "fail" | "muted" } {
  if (!log.matched_trigger_id) return { label: "No coincidió", tone: "muted" };
  if (log.error) return { label: "Error", tone: "fail" };
  if (log.dm_sent) return { label: "Mensaje enviado", tone: "ok" };
  return { label: "No se envió", tone: "fail" };
}

/** El link para crear una automatizacion de comentario o de palabra clave, con la palabra y la cuenta. */
export function newCommentAutomationBody(args: { trigger: "comment_keyword" | "keyword"; keyword: string | null; channelId: string | null }) {
  const keyword = args.keyword?.trim().slice(0, 60) || null;
  const data: Record<string, unknown> = {
    triggerType: args.trigger,
    keywords: keyword ? [{ value: keyword, matchType: args.trigger === "comment_keyword" ? "exact" : "contains" }] : [],
  };
  if (args.channelId) data.channelId = args.channelId;
  return {
    name: keyword ? `Comentario «${keyword}»` : "Automatización de comentario",
    categories: ["Comentarios"],
    nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data }],
  };
}

/** Desde cuando se cuentan las metricas de la pestana (30 dias atras). */
export function commentStatsSince(now: Date = new Date()): string {
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
}
