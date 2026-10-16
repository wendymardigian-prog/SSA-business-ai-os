/**
 * "Que hizo el agente con este mensaje" (A1.2 a A1.5).
 *
 * Arma, a partir de lo que ya guarda el sistema (corridas, borradores,
 * mensajes y acciones del agente), la historia de cada mensaje de la
 * conversacion: lo analizo, dejo una sugerencia, respondio, no hizo nada y por
 * que, intervino una automatizacion, derivo a una persona o fallo. Sin tabla
 * nueva.
 *
 * Reglas que importan:
 *  - Una SUGERENCIA nunca se confunde con una RESPUESTA ENVIADA: tienen
 *    `outcome` distinto (`suggested` / `executed` / `failed` / `skipped`) y el
 *    panel las dibuja distinto.
 *  - Una corrida se ancla al ULTIMO mensaje del contacto de su rafaga (el que
 *    figura en `inbound_at`); las que no lo traen se anclan al ultimo mensaje
 *    entrante anterior a la corrida, si fue hace menos de 30 minutos.
 *  - Solo cuentan las corridas del agente de chat (`source = 'agent'`): el
 *    resumen de cierre o el clasificador no son una respuesta a un mensaje.
 *  - Lo que no tiene corrida no se inventa: un mensaje sin historia no tiene
 *    indicador.
 *
 * Puro: lo prueba un test y el componente solo lo dibuja.
 */

import { AGENT_ACTION_LABELS } from "@/lib/agent/action-labels";
import { describeRunDetail } from "@/lib/agent/run-labels";

export type ActivityTone = "success" | "info" | "warning" | "error" | "neutral";
export type ActivityOutcome = "suggested" | "executed" | "failed" | "skipped" | "pending";
export type ActivityKind = "analyzed" | "suggestion" | "reply" | "skipped" | "automation" | "escalated" | "failed" | "action";

export interface ActivityRun {
  id: string;
  source: string;
  trigger: string;
  status: string;
  status_detail: string | null;
  created_at: string;
  inbound_at: string | null;
  responded_at?: string | null;
  completed_at?: string | null;
}

export interface ActivityDraft {
  id: string;
  run_id: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  discard_reason: string | null;
  has_body: boolean;
  no_reply_reason: string | null;
}

export interface ActivityAction {
  id: string;
  action: string;
  performed_at: string;
  run_id: string | null;
}

export interface ActivityMessage {
  id: string;
  direction: "inbound" | "outbound";
  created_at: string;
  agent_run_id: string | null;
}

export interface ActivityEntry {
  key: string;
  at: string;
  kind: ActivityKind;
  outcome: ActivityOutcome;
  tone: ActivityTone;
  title: string;
  detail: string | null;
  runId: string | null;
}

export interface ActivitySummary {
  tone: ActivityTone;
  outcome: ActivityOutcome;
  /** Lo corto que acompana al punto: "Agente: respondio". */
  label: string;
}

export interface MessageActivity {
  messageId: string;
  entries: ActivityEntry[];
  summary: ActivitySummary;
}

const ANCHOR_WINDOW_MS = 30 * 60_000;
const ms = (iso: string) => new Date(iso).getTime();

/** El mensaje entrante al que se ancla una corrida, o null. */
export function anchorMessageId(run: ActivityRun, messages: ActivityMessage[]): string | null {
  const inbound = messages.filter((m) => m.direction === "inbound").sort((a, b) => ms(a.created_at) - ms(b.created_at));
  if (inbound.length === 0) return null;
  const limit = run.inbound_at ?? run.created_at;
  let found: ActivityMessage | null = null;
  for (const m of inbound) {
    if (ms(m.created_at) <= ms(limit)) found = m;
  }
  if (!found) return null;
  // Sin `inbound_at` solo se ancla si el mensaje es reciente respecto de la corrida.
  if (!run.inbound_at && ms(run.created_at) - ms(found.created_at) > ANCHOR_WINDOW_MS) return null;
  return found.id;
}

const auto = (reason: string | null) => (reason ?? "").startsWith("auto:");

const AUTO_REASON: Record<string, string> = {
  "auto:manual_reply": "alguien respondió a mano",
  "auto:answered_elsewhere": "ya se respondió desde otro lado",
  "auto:conversation_closed": "se cerró la conversación",
};

function detailOf(run: ActivityRun): string | null {
  const parts = describeRunDetail(run.status_detail);
  return parts.length > 0 ? parts.join("; ").replace(/^./, (c) => c.toUpperCase()) : null;
}

function draftEntry(run: ActivityRun, draft: ActivityDraft | undefined): ActivityEntry {
  const at = draft?.created_at ?? run.completed_at ?? run.created_at;
  const base = { key: `${run.id}:draft`, at, kind: "suggestion" as const, runId: run.id };
  const manual = run.trigger === "manual" ? "La pidió una persona. " : "";
  if (!draft) {
    return { ...base, outcome: "suggested", tone: "warning", title: "Dejó una sugerencia sin enviar", detail: `${manual}Nada salió al contacto.`.trim() };
  }
  if (!draft.has_body && (draft.status === "pending" || draft.status === "failed")) {
    return {
      ...base,
      outcome: "suggested",
      tone: "warning",
      title: "Sugirió que responda una persona",
      detail: draft.no_reply_reason ? `${manual}Motivo: ${describeRunDetail(draft.no_reply_reason).join("; ")}.` : `${manual}No redactó un texto.`.trim(),
    };
  }
  switch (draft.status) {
    case "pending":
    case "sending":
      return { ...base, outcome: "suggested", tone: "warning", title: "Dejó una sugerencia sin enviar", detail: `${manual}Espera que alguien la revise: no salió nada al contacto.` };
    case "sent":
      return { ...base, at: draft.decided_at ?? at, outcome: "executed", tone: "success", title: "Sugerencia aprobada y enviada", detail: "Una persona la revisó y salió al contacto." };
    case "failed":
      return { ...base, at: draft.decided_at ?? at, outcome: "failed", tone: "error", title: "La sugerencia no se pudo enviar", detail: "Podés reintentarlo desde el borrador." };
    case "discarded": {
      const reason = draft.discard_reason ?? "";
      const why = auto(reason) ? (AUTO_REASON[reason] ?? "se retiró sola") : reason ? `Motivo: ${reason}` : null;
      return { ...base, at: draft.decided_at ?? at, outcome: "skipped", tone: "neutral", title: "Sugerencia descartada", detail: why ? why.replace(/^./, (c) => c.toUpperCase()) : "No salió nada al contacto." };
    }
    case "superseded":
    case "regenerated":
      return { ...base, at: draft.decided_at ?? at, outcome: "skipped", tone: "neutral", title: "Sugerencia reemplazada por otra", detail: "Se generó una versión nueva." };
    default:
      return { ...base, outcome: "suggested", tone: "warning", title: "Dejó una sugerencia sin enviar", detail: manual.trim() || null };
  }
}

/** Las entradas que cuenta UNA corrida del agente, en lenguaje llano. */
export function runEntries(run: ActivityRun, draft: ActivityDraft | undefined): ActivityEntry[] {
  const key = run.id;
  const at = run.completed_at ?? run.created_at;
  const detail = detailOf(run);
  switch (run.status) {
    case "running":
      return [{ key, at: run.created_at, kind: "analyzed", outcome: "pending", tone: "info", title: "Está preparando una respuesta", detail: null, runId: run.id }];
    case "responded":
      return [{ key, at: run.responded_at ?? at, kind: "reply", outcome: "executed", tone: "success", title: "Respondió al contacto", detail, runId: run.id }];
    case "drafted":
      return [draftEntry(run, draft)];
    case "escalated":
      return [{ key, at, kind: "escalated", outcome: "executed", tone: "warning", title: "Pasó la conversación a una persona", detail, runId: run.id }];
    case "skipped_automation":
      return [{ key, at, kind: "automation", outcome: "skipped", tone: "info", title: "Intervino una automatización", detail: detail ?? "Un flow se hizo cargo de este mensaje y el agente se abstuvo.", runId: run.id }];
    case "blocked_guardrail":
      return [{ key, at, kind: "skipped", outcome: "skipped", tone: "warning", title: "No respondió: lo frenó un guardarrail", detail, runId: run.id }];
    case "already_answered":
      return [{ key, at, kind: "skipped", outcome: "skipped", tone: "neutral", title: "No hizo nada: ya había una respuesta", detail, runId: run.id }];
    case "skipped":
      return [{ key, at, kind: "skipped", outcome: "skipped", tone: "neutral", title: "No hizo nada", detail: detail ?? "No había nada que hacer en este turno.", runId: run.id }];
    case "error":
      return [{ key, at, kind: "failed", outcome: "failed", tone: "error", title: "Falló al preparar la respuesta", detail, runId: run.id }];
    case "completed":
      return [{ key, at, kind: "analyzed", outcome: "executed", tone: "neutral", title: "Terminó el turno", detail, runId: run.id }];
    default:
      return [{ key, at, kind: "analyzed", outcome: "skipped", tone: "neutral", title: "Analizó el mensaje", detail, runId: run.id }];
  }
}

const TONE_RANK: Record<ActivityTone, number> = { error: 5, warning: 4, success: 3, info: 2, neutral: 1 };

const SUMMARY_LABEL: Record<ActivityKind, string> = {
  analyzed: "analizó",
  suggestion: "sugerencia",
  reply: "respondió",
  skipped: "no hizo nada",
  automation: "automatización",
  escalated: "derivó",
  failed: "falló",
  action: "acción",
};

/** El punto de un mensaje: lo mas importante de lo que paso. */
export function summarize(entries: ActivityEntry[]): ActivitySummary {
  const main = entries.filter((e) => e.kind !== "action");
  const pool = main.length > 0 ? main : entries;
  const top = [...pool].sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone] || ms(b.at) - ms(a.at))[0];
  const label =
    top.kind === "suggestion"
      ? top.outcome === "executed"
        ? "sugerencia enviada"
        : top.outcome === "skipped"
          ? "sugerencia descartada"
          : top.outcome === "failed"
            ? "sugerencia sin enviar"
            : "sugerencia pendiente"
      : SUMMARY_LABEL[top.kind];
  return { tone: top.tone, outcome: top.outcome, label: `Agente: ${label}` };
}

/**
 * La actividad de cada mensaje con historia. La clave es el id del mensaje:
 * el ultimo entrante de cada rafaga (donde se anclan las corridas) y los
 * mensajes salientes que mando el agente (`agent_run_id`).
 */
export function buildActivity(input: {
  messages: ActivityMessage[];
  runs: ActivityRun[];
  drafts: ActivityDraft[];
  actions: ActivityAction[];
  /** Etiquetas de las acciones; por defecto las del agente. */
  actionLabels?: Record<string, string>;
}): Map<string, MessageActivity> {
  const labels = input.actionLabels ?? AGENT_ACTION_LABELS;
  const draftByRun = new Map<string, ActivityDraft>();
  for (const d of input.drafts) {
    if (!d.run_id) continue;
    const prev = draftByRun.get(d.run_id);
    if (!prev || ms(d.created_at) > ms(prev.created_at)) draftByRun.set(d.run_id, d);
  }
  const actionsByRun = new Map<string, ActivityAction[]>();
  for (const a of input.actions) {
    if (!a.run_id) continue;
    const list = actionsByRun.get(a.run_id) ?? [];
    list.push(a);
    actionsByRun.set(a.run_id, list);
  }

  const byMessage = new Map<string, ActivityEntry[]>();
  const push = (messageId: string, entries: ActivityEntry[]) => {
    const list = byMessage.get(messageId) ?? [];
    for (const e of entries) if (!list.some((x) => x.key === e.key)) list.push(e);
    byMessage.set(messageId, list);
  };

  for (const run of input.runs) {
    if (run.source !== "agent" || run.trigger === "cron_close") continue;
    const entries = runEntries(run, draftByRun.get(run.id));
    for (const a of actionsByRun.get(run.id) ?? []) {
      entries.push({
        key: `${run.id}:action:${a.id}`,
        at: a.performed_at,
        kind: "action",
        outcome: "executed",
        tone: "neutral",
        title: labels[a.action] ?? "Hizo un cambio",
        detail: null,
        runId: run.id,
      });
    }
    const anchor = anchorMessageId(run, input.messages);
    if (anchor) push(anchor, entries);
    // El mensaje que mando el agente en esa corrida cuenta la misma historia.
    for (const m of input.messages) {
      if (m.direction === "outbound" && m.agent_run_id === run.id) push(m.id, entries);
    }
  }

  const result = new Map<string, MessageActivity>();
  for (const [messageId, entries] of byMessage) {
    entries.sort((a, b) => ms(a.at) - ms(b.at));
    result.set(messageId, { messageId, entries, summary: summarize(entries) });
  }
  return result;
}
