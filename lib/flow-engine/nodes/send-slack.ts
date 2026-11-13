/**
 * «Enviar a Slack» (Servicios A4, F158): un mensaje a un canal de Slack o, por mensaje directo, a una persona del
 * equipo que cargó su ID de Slack en Mi cuenta. No necesita contacto. Necesita Slack conectado (Ajustes ›
 * Integraciones). El token se lee de Vault en el momento y nunca se loguea. Un fallo de Slack no frena el flujo:
 * queda anotado en el paso con su motivo.
 */
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { FlowExecutionContext } from "../types";
import { interpolateVariables } from "../interpolate";
import { readSecret } from "@/lib/vault";
import { SECRET_NAMES } from "@/lib/secret-names";
import { postMessage } from "@/lib/integrations/slack";

export const SLACK_TEXT_MAX = 3000;

export interface SendSlackNodeData {
  /** `channel`: un canal (su ID, C…, o #nombre). `person`: una persona del equipo, por mensaje directo. */
  target?: "channel" | "person";
  channel?: string;
  userId?: string;
  text?: string;
}

/** A dónde va, ya validado. Puro. */
export function slackDestination(data: SendSlackNodeData, slackUserId: string | null): { ok: true; to: string } | { ok: false; reason: string } {
  if ((data.target ?? "channel") === "channel") {
    const ch = (data.channel ?? "").trim();
    if (!/^(#[\w.-]{1,80}|[CG][A-Z0-9]{2,})$/.test(ch)) return { ok: false, reason: "Falta el canal de Slack (su ID, como C0123…, o #nombre)." };
    return { ok: true, to: ch.startsWith("#") ? ch.slice(1) : ch };
  }
  if (!data.userId) return { ok: false, reason: "Falta elegir a quién mandarle el mensaje." };
  if (!slackUserId) return { ok: false, reason: "Esa persona no cargó su ID de Slack en Mi cuenta." };
  return { ok: true, to: slackUserId };
}

async function execute({ supabase, data, context, node }: NodeExecutionArgs<SendSlackNodeData, FlowExecutionContext>) {
  const note = (status: "skipped" | "failed", reason: string) => {
    console.warn(`[flow-engine] el nodo ${node.id} (send_slack) ${status === "failed" ? "falló" : "se saltea"}: ${reason}`);
    context.noteStep?.({ status, reason });
  };
  const text = interpolateVariables(data.text ?? "", context.variables ?? {}).trim().slice(0, SLACK_TEXT_MAX);
  if (!text) return note("skipped", "El mensaje está vacío.");

  let slackUserId: string | null = null;
  if (data.target === "person" && data.userId) {
    const { data: member } = await supabase.from("workspace_members").select("user_id").eq("workspace_id", context.workspaceId).eq("user_id", data.userId).maybeSingle();
    if (!member) return note("skipped", "Esa persona ya no es del equipo.");
    const { data: profile } = await supabase.from("user_profiles").select("slack_user_id" as never).eq("user_id", data.userId).maybeSingle();
    slackUserId = (profile as { slack_user_id?: string | null } | null)?.slack_user_id ?? null;
  }
  const dest = slackDestination(data, slackUserId);
  if (!dest.ok) return note("skipped", dest.reason);

  let token: string | null = null;
  try {
    token = await readSecret(supabase, context.workspaceId, SECRET_NAMES.slackBotToken);
  } catch {
    return note("failed", "No se pudo leer la conexión con Slack. Probá de nuevo en un rato.");
  }
  if (!token) return note("skipped", "Slack no está conectado.");
  const res = await postMessage(token, dest.to, text);
  if (!res.ok) return note("failed", res.error);
}

export const sendSlackNode: NodeDefinition<SendSlackNodeData> = {
  needsContact: false,
  type: "send_slack",
  label: "Enviar a Slack",
  aliases: [{ nodeType: "action", actionType: "send_slack" }],
  requires: ["slack"],
  execute,
};
