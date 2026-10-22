/**
 * Una cuenta recien conectada y la bandeja por cuenta (00249).
 *
 * Un rol en "todas las cuentas" la ve sola. Uno en "elegir por cuenta" NO la ve hasta que alguien se la de
 * (decision de producto: una cuenta personal o de otra marca no queda visible sin que nadie lo note). Para que
 * no quede una cuenta sin nadie mirandola por olvido, al conectarla se avisa a Owner y Admin en la campana,
 * con el link a Roles.
 *
 * Nunca lanza: un aviso que falla no puede tumbar la conexion de una cuenta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseChannels } from "@/lib/auth/channel-permissions";
import { createNotification } from "@/lib/notifications/create";
import type { Database } from "@/lib/types/database";

/** Los roles personalizados que eligen cuenta por cuenta: los que no ven una cuenta nueva. Puro. */
export function rolesWithoutNewChannel(roles: Array<{ name: string; permissions: unknown }>): string[] {
  return roles
    .filter((r) => parseChannels((r.permissions as { channels?: unknown } | null)?.channels).mode === "custom")
    .map((r) => r.name);
}

/** El texto del aviso, con los nombres de los roles (hasta tres). Puro. */
export function newChannelNotice(label: string, roleNames: string[]): { title: string; body: string } {
  const shown = roleNames.slice(0, 3).map((n) => `«${n}»`).join(", ");
  const rest = roleNames.length > 3 ? ` y ${roleNames.length - 3} más` : "";
  const which = roleNames.length === 1 ? `El rol ${shown} elige` : `Los roles ${shown}${rest} eligen`;
  return {
    title: `Conectaste ${label}: ningún rol personalizado la ve todavía`,
    body: `${which} cuenta por cuenta, así que no ve${roleNames.length === 1 ? "" : "n"} esta. Si alguien tiene que atenderla, dásela en Ajustes → Roles.`,
  };
}

/**
 * Avisa a Owner y Admin si hay roles que no van a ver la cuenta nueva. Con el cliente de servicio (la tabla de
 * avisos no tiene policy de INSERT). No lanza nunca.
 */
export async function notifyNewChannelAccess(
  service: SupabaseClient<Database>,
  params: { workspaceId: string; channelId: string; label: string },
): Promise<void> {
  try {
    const { data, error } = await service
      .from("workspace_roles")
      .select("name, permissions")
      .eq("workspace_id", params.workspaceId)
      .is("system_role", null);
    if (error) {
      console.error("[canales] no pude revisar los roles para la cuenta nueva:", error.message);
      return;
    }
    const names = rolesWithoutNewChannel(data ?? []);
    if (names.length === 0) return;
    const notice = newChannelNotice(params.label, names);
    await createNotification({
      supabase: service,
      workspaceId: params.workspaceId,
      type: "channel_access_needed",
      title: notice.title,
      body: notice.body,
      entityType: "channel",
      entityId: params.channelId,
      metadata: { target: "roles", roles: names.length },
    });
  } catch (err) {
    console.error("[canales] no pude avisar de la cuenta nueva:", err instanceof Error ? err.message : String(err));
  }
}
