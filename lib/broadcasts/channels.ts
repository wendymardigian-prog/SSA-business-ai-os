/**
 * Por qué canales puede salir un broadcast: los números de WhatsApp conectados
 * con Evolution y el canal de email (Resend). Instagram queda afuera a
 * propósito (decisión del 3/11/2026): la ventana de 24 h no deja escribir en
 * frío y, en los negocios con ManyChat, ManyChat es la dueña de los hilos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { DEFAULT_EMAIL_POLICY, DEFAULT_WHATSAPP_POLICY, parsePolicy, type SendPolicy } from "@/lib/send-queue/pace";
import type { BroadcastChannelKind } from "./audience";

export interface BroadcastChannel {
  id: string;
  kind: BroadcastChannelKind;
  label: string;
  policy: SendPolicy;
  /** Para avisar en la pantalla (el número está desconectado, por ejemplo). */
  connectionStatus: string | null;
}

interface ChannelRow {
  id: string;
  platform: string;
  provider: string;
  display_name: string | null;
  username: string | null;
  email_address: string | null;
  evolution_instance: string | null;
  connection_status: string | null;
  is_active: boolean;
  send_policy: Json | null;
}

const COLUMNS = "id, platform, provider, display_name, username, email_address, evolution_instance, connection_status, is_active, send_policy";

/** El tipo de canal de un broadcast, o null si ese canal no sirve para mandar masivos. Rama explícita por proveedor. */
export function broadcastKindOf(row: Pick<ChannelRow, "platform" | "provider" | "evolution_instance" | "email_address" | "is_active">): BroadcastChannelKind | null {
  if (!row.is_active) return null;
  if (row.provider === "evolution" && row.platform === "whatsapp") return row.evolution_instance ? "whatsapp" : null;
  if (row.provider === "resend" && row.platform === "email") return row.email_address ? "email" : null;
  return null;
}

export function defaultPolicyFor(kind: BroadcastChannelKind): SendPolicy {
  return kind === "whatsapp" ? DEFAULT_WHATSAPP_POLICY : DEFAULT_EMAIL_POLICY;
}

function toChannel(row: ChannelRow): BroadcastChannel | null {
  const kind = broadcastKindOf(row);
  if (!kind) return null;
  const name = row.display_name || row.username || row.email_address || row.evolution_instance || "Canal";
  return {
    id: row.id,
    kind,
    label: kind === "whatsapp" ? `WhatsApp · ${name}` : `Email · ${row.email_address ?? name}`,
    policy: parsePolicy(row.send_policy, defaultPolicyFor(kind)),
    connectionStatus: row.connection_status,
  };
}

/** Los canales del workspace por los que puede salir un broadcast. */
export async function listBroadcastChannels(supabase: SupabaseClient<Database>, workspaceId: string): Promise<BroadcastChannel[]> {
  const { data, error } = await supabase
    .from("channels")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .in("platform", ["whatsapp", "email"])
    .order("created_at");
  if (error) {
    console.error("[broadcasts] no pude leer los canales:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as ChannelRow[]).map(toChannel).filter((c): c is BroadcastChannel => c !== null);
}

/** Un canal del workspace, si sirve para broadcasts. */
export async function loadBroadcastChannel(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  channelId: string,
): Promise<BroadcastChannel | null> {
  const { data } = await supabase.from("channels").select(COLUMNS).eq("id", channelId).eq("workspace_id", workspaceId).maybeSingle();
  return data ? toChannel(data as unknown as ChannelRow) : null;
}
