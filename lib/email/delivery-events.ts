/**
 * Rebotes y quejas que avisa Resend (suscripcion a emails, E4).
 *
 * Llegan al MISMO receptor que el correo entrante (`/api/webhooks/resend-inbound`),
 * con el mismo secreto de firma (Svix): en el panel de Resend, el webhook suma los
 * eventos `email.bounced` y `email.complained`. No hay secreto nuevo.
 *
 *  - `email.bounced` con `bounce.type = "Permanent"` (rebote duro) → `bounced`.
 *    Un rebote temporal (`Temporary`) se anota y NO cambia el estado.
 *  - `email.complained` (la persona lo marco como spam) → `complained`.
 * Los dos en modo `system` (solo empeoran), por direccion: alcanzan a todos los
 * contactos del workspace que la tienen.
 *
 * De que workspace es: el evento no trae una direccion de canal (llega a NUESTRO
 * remitente, no a un buzon). Se busca, en orden: por el id del email que mandamos
 * (`email_log.provider_message_id`, `messages.platform_message_id` /
 * `email_message_id`), por el remitente (la config de Resend o un canal de email),
 * y si no, se prueba la firma con el secreto de cada workspace que tiene Resend.
 * Si ninguna firma coincide, se rechaza. Si coincide pero la direccion no es de
 * ningun contacto, se anota y se ignora.
 *
 * Solo servidor. El token, el secreto y el cuerpo del evento nunca se loguean.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { bareAddress } from "./reply";
import { setEmailStatusByAddress, type EmailStatus } from "./subscription";

export interface DeliveryEvent {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    bounce?: { type?: string; subType?: string; message?: string };
  };
}

export const DELIVERY_EVENT_TYPES = ["email.bounced", "email.complained"] as const;

export function isDeliveryEvent(type: string | undefined): boolean {
  return (DELIVERY_EVENT_TYPES as readonly string[]).includes(type ?? "");
}

export type DeliveryDecision =
  | { action: "set"; status: Extract<EmailStatus, "bounced" | "complained">; source: "resend_bounce" | "resend_complaint" }
  | { action: "note"; reason: string };

/** Que hacer con el evento. Puro. */
export function classifyDeliveryEvent(event: DeliveryEvent): DeliveryDecision {
  if (event.type === "email.complained") return { action: "set", status: "complained", source: "resend_complaint" };
  if (event.type === "email.bounced") {
    const kind = (event.data?.bounce?.type ?? "").trim().toLowerCase();
    if (kind === "permanent") return { action: "set", status: "bounced", source: "resend_bounce" };
    return { action: "note", reason: `rebote temporal (${kind || "sin tipo"}): no cambia el estado` };
  }
  return { action: "note", reason: "evento que no es de entrega" };
}

/** Las direcciones a las que se mando (normalmente una). */
export function recipientsOf(event: DeliveryEvent): string[] {
  return [...new Set((event.data?.to ?? []).map((a) => bareAddress(a)).filter((a): a is string => Boolean(a)))];
}

type Service = Pick<SupabaseClient, "from">;

/**
 * Los workspaces candidatos, del mas probable al menos: el del email que mandamos,
 * el del remitente, y despues todos los que tienen Resend (para probar la firma).
 */
export async function candidateWorkspaces(service: Service, event: DeliveryEvent): Promise<string[]> {
  const out: string[] = [];
  const add = (id: unknown) => {
    if (typeof id === "string" && id && !out.includes(id)) out.push(id);
  };
  const emailId = event.data?.email_id?.trim();

  if (emailId) {
    const { data: logged } = await service.from("email_log").select("workspace_id").eq("provider_message_id", emailId).limit(1);
    for (const row of (logged ?? []) as Array<{ workspace_id: string }>) add(row.workspace_id);
    if (out.length === 0) {
      const { data: byPlatform } = await service.from("messages").select("workspace_id").eq("platform_message_id", emailId).limit(1);
      for (const row of (byPlatform ?? []) as Array<{ workspace_id: string }>) add(row.workspace_id);
    }
    if (out.length === 0) {
      const { data: byEmailId } = await service.from("messages").select("workspace_id").eq("email_message_id", emailId).limit(1);
      for (const row of (byEmailId ?? []) as Array<{ workspace_id: string }>) add(row.workspace_id);
    }
  }

  const from = bareAddress(event.data?.from);
  const { data: configs } = await service
    .from("integration_configs")
    .select("workspace_id, provider, config")
    .eq("type", "email_provider")
    .in("provider", ["resend", "resend_inbound"]);
  const rows = (configs ?? []) as Array<{ workspace_id: string; config: Record<string, unknown> | null }>;
  if (from) {
    for (const row of rows) {
      const c = row.config ?? {};
      const senders = [c.from_email, c.marketing_from_email, c.inbound_address].map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""));
      if (senders.includes(from)) add(row.workspace_id);
    }
    const { data: channels } = await service.from("channels").select("workspace_id, email_address").eq("platform", "email");
    for (const ch of (channels ?? []) as Array<{ workspace_id: string; email_address: string | null }>) {
      if ((ch.email_address ?? "").trim().toLowerCase() === from) add(ch.workspace_id);
    }
  }
  for (const row of rows) add(row.workspace_id);
  return out;
}

export interface DeliveryResult {
  /** Lo que se hizo, para el log (sin direcciones). */
  note: string;
  changed: number;
}

/** Aplica el evento (ya con la firma verificada) en el workspace. Nunca lanza. */
export async function applyDeliveryEvent(service: Pick<SupabaseClient, "rpc">, workspaceId: string, event: DeliveryEvent): Promise<DeliveryResult> {
  const decision = classifyDeliveryEvent(event);
  if (decision.action === "note") return { note: decision.reason, changed: 0 };
  const recipients = recipientsOf(event);
  if (recipients.length === 0) return { note: "sin destinatario", changed: 0 };

  let changed = 0;
  let unknown = 0;
  for (const address of recipients) {
    try {
      const result = await setEmailStatusByAddress(service, workspaceId, address, {
        status: decision.status,
        source: decision.source,
        mode: "system",
        reason: event.data?.bounce?.message?.slice(0, 300) ?? null,
        extra: {
          email_id: event.data?.email_id ?? null,
          ...(event.data?.bounce?.subType ? { bounce_subtype: event.data.bounce.subType } : {}),
        },
      });
      if (result.notFound) unknown++;
      changed += result.contactsChanged;
    } catch (error) {
      console.error("[resend-eventos] no pude aplicar el evento:", error instanceof Error ? error.message : "error");
    }
  }
  if (unknown === recipients.length) return { note: "la direccion no es de ningun contacto: se ignora", changed: 0 };
  return { note: `${decision.status}: ${changed} contacto(s) cambiados`, changed };
}
