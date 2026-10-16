/**
 * La atribución de un comentario (F86).
 *
 * Cuando alguien comenta una publicación y esa persona es (o pasa a ser) un
 * contacto, ese comentario es un toque: el origen de la relación puede ser "te
 * vi comentando el reel de dólares". Esto vincula el comentario con su contacto
 * y anota ese toque con la pieza concreta.
 *
 * Dos reglas que NO son obvias:
 *
 * 1. **Instagram no crea contactos desde un comentario, salvo que el negocio lo
 *    prenda** (Ajustes > General > Atribución, `comments_create_contact.instagram`,
 *    apagado por defecto). Apagado: solo se vincula si la persona ya es contacto,
 *    o si la automatización por palabra clave lo creó (por eso se llama dos
 *    veces: antes y después de `processComment`). Prendido: nace un contacto
 *    NO anónimo ("@usuario"), que aparece en las listas y dispara "contacto nuevo".
 * 2. **TikTok crea un contacto anónimo** (prendido por defecto; si se apaga, solo
 *    busca). No tiene canal ni mensajes directos: el comentario es la única señal
 *    que va a haber. El contacto nace anónimo (con su `tiktok_username`), que el
 *    sistema ya sabe ocultar de las listas y no cuenta como "contacto nuevo". El
 *    día que escriba por otro canal, `find_or_link_contact` lo unifica.
 *
 * Los comentarios PROPIOS no crean contacto ni toque, y esto no toca
 * `processComment` ni las automatizaciones.
 *
 * **NUNCA lanza**: el comentario ya está guardado y la automatización corre
 * aparte. Una estadística no puede frenar nada.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { TouchAccount } from "@/lib/inbox/accounts";
import { findContact, findOrCreateContact } from "@/lib/contacts/find-or-create";
import { shouldCreateFromComment, type AttributionSettings } from "@/lib/attribution/settings";
import { loadAttributionSettings } from "@/lib/attribution/settings-load";
import { linkCommentToContact } from "./link-to-contact";

type Db = SupabaseClient<Database>;

/** Las dos redes con comentarios. */
const SUPPORTED = { instagram: true, tiktok: true } as const;

/**
 * El nombre con el que nace un contacto de TikTok que solo comentó. Es uno de los
 * marcadores que la columna generada `is_anonymous` reconoce (00032): por eso
 * queda anónimo, y por eso este texto no se puede cambiar a la ligera.
 */
const ANONYMOUS_NAME = "Unknown commenter";

export interface CommentAttributionParams {
  workspaceId: string;
  platform: string;
  /** El id del comentario EN LA RED. */
  externalCommentId: string;
  authorUsername: string | null;
  isOwn: boolean;
  commentedAt: string | null;
  /** La publicación comentada, si se conoce. Null = comentario huérfano. */
  socialPostId: string | null;
  /**
   * El id del anuncio de Meta cuando el comentario es sobre CONTENIDO PAGO (`comment.ad.id`, solo Instagram).
   * El toque lleva ese `ad_id` y medio `paid_social`: el comentario viene de un anuncio (Extra L, F19).
   */
  adId?: string | null;
  /** La cuenta nuestra donde comentaron (varias cuentas de la misma red). Queda en el toque. */
  account?: TouchAccount | null;
  /** La configuración ya leída (los tests y el job la pasan); si falta, se lee del workspace. */
  settings?: AttributionSettings;
}

export interface CommentAttributionResult {
  contactId: string | null;
  /** Se creó un contacto (anónimo en TikTok; con "@usuario" en Instagram si la opción está prendida). */
  createdContact: boolean;
  /** Quedó un toque nuevo. */
  touched: boolean;
}

const NOTHING: CommentAttributionResult = { contactId: null, createdContact: false, touched: false };

/**
 * Vincula el comentario con su contacto y anota el toque. `supabase` es el
 * cliente de servicio. Idempotente: se puede llamar antes y después de
 * `processComment` sin duplicar nada (el toque se deduplica por el id del
 * comentario).
 */
export async function attributeComment(
  supabase: Db,
  params: CommentAttributionParams,
): Promise<CommentAttributionResult> {
  try {
    if (params.isOwn) return NOTHING;

    const platform = params.platform as keyof typeof SUPPORTED;
    const username = params.authorUsername?.trim();
    if (!SUPPORTED[platform] || !username) return NOTHING;

    const settings = params.settings ?? (await loadAttributionSettings(supabase, params.workspaceId));
    const create = shouldCreateFromComment(settings, params.platform);

    // La regla única (00200): el usuario se compara en minúsculas y sin "@", y dos comentarios
    // simultáneos de la misma persona dan UN contacto.
    const identity = platform === "tiktok" ? { tiktok: username } : { instagram: username };
    let contactId: string | null;
    let createdContact = false;
    if (create) {
      const result = await findOrCreateContact(supabase, {
        workspaceId: params.workspaceId,
        identity,
        defaults:
          platform === "tiktok"
            ? { display_name: ANONYMOUS_NAME, last_interaction_at: new Date().toISOString() }
            : { display_name: `@${username.replace(/^@+/, "")}`, last_interaction_at: new Date().toISOString() },
        mode: "create",
      });
      contactId = result.contactId;
      createdContact = result.created;
    } else {
      contactId = (await findContact(supabase, { workspaceId: params.workspaceId, identity })).contactId;
    }

    if (!contactId) return NOTHING;

    const result = await linkCommentToContact(supabase, {
      workspaceId: params.workspaceId,
      contactId,
      comment: {
        platform: params.platform,
        externalCommentId: params.externalCommentId,
        commentedAt: params.commentedAt,
        socialPostId: params.socialPostId,
        adId: params.adId,
        account: params.account,
      },
    });

    return { contactId, createdContact, touched: result.touched };
  } catch (err) {
    console.error("[atribucion] fallo la atribucion del comentario:", err instanceof Error ? err.message : String(err));
    return NOTHING;
  }
}
