/**
 * Lee el último mensaje saliente de la conversación con una pieza y decide si el entrante la hereda (Extra I, F35).
 * La decisión es pura (`inheritContent`); acá solo está la lectura. SOLO servidor, con el cliente de servicio. NUNCA lanza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { inheritContent, type InheritedContent } from "./inherit";

export interface InheritedWithTitle extends InheritedContent {
  title: string | null;
}

export async function loadInheritedContent(
  db: SupabaseClient<Database>,
  args: { conversationId: string; inboundOriginContext: unknown; now: Date; days: number },
): Promise<InheritedWithTitle | null> {
  try {
    const { data, error } = await db
      .from("messages")
      .select("id, created_at, origin_context")
      .eq("conversation_id", args.conversationId)
      .eq("direction", "outbound")
      .not("origin_context->content", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as unknown as { id: string; created_at: string; origin_context: unknown };
    const inherited = inheritContent(row, { origin_context: args.inboundOriginContext }, args.now, args.days);
    if (!inherited) return null;
    const content = (row.origin_context as { content?: { title?: unknown } } | null)?.content;
    const title = typeof content?.title === "string" && content.title.trim() ? content.title.trim().slice(0, 120) : null;
    return { ...inherited, title };
  } catch {
    return null;
  }
}
