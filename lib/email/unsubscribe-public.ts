/**
 * La baja pública por token (suscripcion a emails, E3): lo que comparten la página
 * `/baja/<token>`, sus acciones y el endpoint de un clic `POST /api/email/baja/<token>`.
 *
 * Reglas:
 *  - El token es `contacts.email_unsubscribe_token` (uuid). Uno que no tiene forma
 *    de uuid no llega a la base. Uno que no existe da un mensaje generico, sin datos.
 *  - Lo unico que sale del contacto es la direccion ENMASCARADA (`w***@gmail.com`) y
 *    la marca del negocio. Nada mas: ni nombre, ni ids, ni el estado de otros.
 *  - Abrir la pagina no da de baja. La baja la hace el boton (modo `person`, source
 *    `unsubscribe_page`) o el POST de un clic (source `one_click`). Volver a
 *    suscribirse tambien es `person`, y no se puede desde un rebote o una queja.
 *  - La baja alcanza a la direccion: todos los contactos del workspace que la tienen.
 *  - Tope por IP, como los otros endpoints publicos.
 *
 * Solo servidor: recibe el cliente de servicio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBrand } from "@/lib/brand";
import { checkLimit } from "@/lib/antispam/rate-limit";
import { hashIp } from "@/lib/scheduling/antispam";
import { isEmailStatus, maskEmailAddress, setEmailStatus, type EmailStatus } from "./subscription";

/** Pedidos por minuto y por IP a la pagina, sus botones y el endpoint de un clic. */
export const UNSUBSCRIBE_REQUESTS_PER_MINUTE = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUnsubscribeToken(token: string | null | undefined): token is string {
  return typeof token === "string" && UUID.test(token);
}

export interface UnsubscribeTarget {
  contactId: string;
  workspaceId: string;
  /** La direccion (principal o, si no hay, la secundaria), sin enmascarar: solo servidor. */
  address: string | null;
  status: EmailStatus;
  brandName: string;
}

/** Lo que puede ver la persona en la pagina publica. */
export interface UnsubscribeView {
  maskedAddress: string;
  status: EmailStatus;
  brandName: string;
  /** Desde un rebote o una queja no se ofrece volver. */
  canResubscribe: boolean;
}

export function publicView(target: UnsubscribeTarget): UnsubscribeView {
  return {
    maskedAddress: maskEmailAddress(target.address),
    status: target.status,
    brandName: target.brandName,
    canResubscribe: target.status === "subscribed" || target.status === "unsubscribed",
  };
}

type Service = Pick<SupabaseClient, "from" | "rpc">;

/** El contacto del token, con la marca de su negocio. `null` si el token no sirve. */
export async function loadUnsubscribeTarget(service: Service, token: string): Promise<UnsubscribeTarget | null> {
  if (!isUnsubscribeToken(token)) return null;
  const { data, error } = await service
    .from("contacts")
    .select("id, workspace_id, email, secondary_email, email_status")
    .eq("email_unsubscribe_token", token)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; workspace_id: string; email: string | null; secondary_email: string | null; email_status: string };
  const { data: ws } = await service
    .from("workspaces")
    .select("brand_name, brand_logo_path, brand_color")
    .eq("id", row.workspace_id)
    .maybeSingle();
  return {
    contactId: row.id,
    workspaceId: row.workspace_id,
    address: row.email?.trim() || row.secondary_email?.trim() || null,
    status: isEmailStatus(row.email_status) ? row.email_status : "subscribed",
    brandName: resolveBrand(ws as { brand_name?: string | null } | null).name,
  };
}

/** El tope por IP. Nunca lanza: si el contador falla, deja pasar (como los otros endpoints publicos). */
export async function allowUnsubscribeRequest(service: Service, ip: string): Promise<boolean> {
  const result = await checkLimit(service as never, { key: `email:baja:${hashIp(ip)}`, max: UNSUBSCRIBE_REQUESTS_PER_MINUTE, windowMs: 60_000 });
  return result.allowed;
}

export type UnsubscribeAction = "unsubscribe" | "resubscribe";

/** Lo que devuelven los botones de la pagina (lib/actions/email-unsubscribe.ts). */
export type UnsubscribePageResult = { ok: true; view: UnsubscribeView } | { ok: false; error: string };

export type UnsubscribeOutcome =
  | { ok: true; view: UnsubscribeView }
  | { ok: false; reason: "not_found" | "rate_limited" | "error" };

/**
 * Da de baja o vuelve a suscribir la direccion del token, como la propia persona.
 * `source`: `unsubscribe_page` (el boton de la pagina) o `one_click` (el cliente de correo).
 */
export async function applyUnsubscribeAction(
  service: Service,
  input: { token: string; ip: string; action: UnsubscribeAction; source: "unsubscribe_page" | "one_click" },
): Promise<UnsubscribeOutcome> {
  if (!(await allowUnsubscribeRequest(service, input.ip))) return { ok: false, reason: "rate_limited" };
  const target = await loadUnsubscribeTarget(service, input.token);
  if (!target) return { ok: false, reason: "not_found" };
  try {
    const result = await setEmailStatus(service, target.contactId, {
      status: input.action === "unsubscribe" ? "unsubscribed" : "subscribed",
      source: input.source,
      mode: "person",
      address: target.address,
    });
    const status = result.status ?? target.status;
    return { ok: true, view: publicView({ ...target, status }) };
  } catch (error) {
    console.error("[email] no pude aplicar la baja publica:", error instanceof Error ? error.message : "error");
    return { ok: false, reason: "error" };
  }
}
