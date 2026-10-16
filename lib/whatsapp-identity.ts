/**
 * El numero de cada canal de WhatsApp, para llamarlo por lo que es.
 *
 * Al conectar, un canal nuevo se llama "WhatsApp", "WhatsApp 2"... Cuando Evolution informa que la sesion quedo
 * abierta, se le pregunta con que numero y el canal pasa a llamarse "WhatsApp +5491122334455": es lo que se ve en el
 * menu Canal y en cada conversacion de la bandeja. Un nombre que una persona escribio no se pisa.
 *
 * NUNCA lanza: el canal ya esta conectado y el mensaje ya llego; no poder leer el numero solo deja el nombre generico.
 * Devuelve el nombre nuevo si lo cambio (para que la pantalla lo muestre sin recargar), o null.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { fetchInstanceOwner, type EvolutionConfig } from "@/lib/evolution-client";
import { nextWhatsappName, phoneFromJid } from "@/lib/whatsapp-numbers";

type Db = SupabaseClient<Database>;

export async function refreshWhatsappIdentity(
  supabase: Db,
  config: EvolutionConfig,
  channel: { id: string; evolution_instance: string | null; display_name: string | null },
): Promise<string | null> {
  try {
    if (!channel.evolution_instance) return null;
    const phone = phoneFromJid(await fetchInstanceOwner(config, channel.evolution_instance));
    const name = nextWhatsappName(channel.display_name, phone);
    if (!name) return null;
    const { error } = await supabase.from("channels").update({ display_name: name }).eq("id", channel.id);
    if (error) {
      console.error("[whatsapp] no pude guardar el numero del canal:", error.message);
      return null;
    }
    return name;
  } catch (err) {
    console.error("[whatsapp] no pude leer el numero del canal:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
