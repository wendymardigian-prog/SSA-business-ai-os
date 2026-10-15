/**
 * Lo que los receptores de mensajes (Zernio y Evolution) agregan al origen de un mensaje entrante (Extra I, F33 y F35):
 *
 *   - la pieza de la HISTORIA a la que respondió (si la historia es nuestra);
 *   - la pieza que HEREDA del último DM de una automatización al que está respondiendo (si no trae un origen propio).
 *
 * Se resuelve ANTES de guardar el mensaje, para que `origin_context` quede completo en el mismo insert. SOLO servidor, con
 * el cliente de servicio. NUNCA lanza: si algo falla, el mensaje se guarda como siempre y no suma pieza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { hasOwnOrigin } from "./inherit";
import { loadInheritedContent, type InheritedWithTitle } from "./inherit-load";
import { loadAttributionSettings } from "./settings-load";
import { resolveStoryPiece, type StoryPiece } from "./story-piece";

export interface InboundOriginExtras {
  storyPiece: StoryPiece | null;
  inherited: InheritedWithTitle | null;
}

const NOTHING: InboundOriginExtras = { storyPiece: null, inherited: null };

export async function resolveInboundOriginExtras(
  db: SupabaseClient<Database>,
  args: {
    workspaceId: string;
    conversationId: string;
    platform: string;
    storyId: string | null | undefined;
    /** El `origin_context` del mensaje armado SIN pieza: de ahí sale si trae un origen propio. */
    baseOriginContext: unknown;
    now?: Date;
  },
): Promise<InboundOriginExtras> {
  try {
    const storyPiece = args.storyId ? await resolveStoryPiece(db, { workspaceId: args.workspaceId, platform: args.platform, storyId: args.storyId }) : null;
    if (hasOwnOrigin(args.baseOriginContext)) return { storyPiece, inherited: null };
    const settings = await loadAttributionSettings(db, args.workspaceId);
    const inherited = await loadInheritedContent(db, {
      conversationId: args.conversationId,
      inboundOriginContext: args.baseOriginContext,
      now: args.now ?? new Date(),
      days: settings.content_inherit_days,
    });
    return { storyPiece, inherited };
  } catch {
    return NOTHING;
  }
}

/** `origin_context.content` de un mensaje que hereda la pieza. */
export function inheritedContentContext(inherited: InheritedWithTitle | null): Record<string, unknown> | undefined {
  if (!inherited) return undefined;
  return {
    social_post_id: inherited.social_post_id,
    content_post_id: inherited.content_post_id,
    via: inherited.via,
    outbound_message_id: inherited.outbound_message_id,
    ...(inherited.title ? { title: inherited.title } : {}),
  };
}
