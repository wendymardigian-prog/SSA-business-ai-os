/**
 * El toque de una venta cargada a mano con canal (Extra I, F47): el servidor lo crea con `recordTouch` ANTES de
 * crear (o editar) la venta, y la venta se atribuye a el en modo `touch` (queda `attribution_type = 'manual'`).
 *
 * Nada de lo que manda el navegador se da por bueno:
 *   - la pieza, el anuncio, el contacto que refirio y la persona del equipo se leen de la base FILTRANDO POR EL
 *     WORKSPACE DE LA SESION (`workspaceId` lo pone quien llama, nunca el pedido);
 *   - el titulo de la pieza sale de la base (el que mando el navegador se descarta);
 *   - el adset y la campaña de un anuncio salen del catalogo, no del navegador;
 *   - la publicacion (`social_post_id`) la decide el servidor: solo si la pieza tiene UNA en esa red.
 *
 * El canal del toque NO se manda: lo calcula un trigger de la base a partir de `medium` y los ids (la funcion
 * `record_contact_touch` esta protegida y no acepta un canal). `buildManualTouch` arma el medio y los ids para que
 * salga el canal buscado, y deja `raw.channel` como dato informativo.
 *
 * Una venta que se vuelve a enviar con la MISMA eleccion deja un solo toque (clave `sale-manual:<clave>`). Si la
 * clave ya existe con OTROS datos (la persona cambio de idea), se usa una clave de reintento derivada de lo elegido.
 *
 * Nunca loguea el contenido del toque.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordTouch } from "@/lib/contacts/touch";
import type { Database } from "@/lib/types/database";
import {
  buildManualTouch,
  manualChoiceReferences,
  manualRetryKey,
  storedTouchMatches,
  type ManualChoice,
  type StoredManualTouch,
} from "./manual-channel";

type Db = SupabaseClient<Database>;

export type ManualTouchResult =
  | { ok: true; touchId: string; channel: string | null }
  | { ok: false; code: "invalid_manual"; error: string };

export interface ManualTouchParams {
  /** El workspace de la SESION. */
  workspaceId: string;
  /** El contacto de la venta. */
  contactId: string;
  choice: ManualChoice;
  /** La fecha de la venta (`YYYY-MM-DD`). */
  saleDate: string;
  /** La zona horaria del negocio. */
  timeZone: string;
  /** El id de la venta o, si todavia no existe, la clave de idempotencia del asistente. */
  saleKey: string;
}

const fail = (error: string): ManualTouchResult => ({ ok: false, code: "invalid_manual", error });

const STORED_COLUMNS = "id, contact_id, channel, source, medium, campaign, content_label, content_post_id, social_post_id, ad_id, adset_id, campaign_id";

interface Resolved {
  ok: true;
  choice: ManualChoice;
}

/** Comprueba que lo elegido es del workspace y lo completa con lo que dice la base. */
async function resolveChoice(service: Db, workspaceId: string, contactId: string, choice: ManualChoice): Promise<Resolved | { ok: false; error: string }> {
  const refs = manualChoiceReferences(choice);

  if (choice.kind === "organic" && refs.contentPostId) {
    const { data: piece, error } = await service
      .from("content_posts")
      .select("id, title")
      .eq("id", refs.contentPostId)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return { ok: false, error: "No pude comprobar la pieza" };
    if (!piece) return { ok: false, error: "Esa pieza no existe" };

    // La publicacion: solo si la pieza tiene UNA en esa red. Lo que mande el navegador no cuenta.
    let socialPostId: string | null = null;
    if (choice.network !== "other") {
      const { data: posts, error: postsError } = await service
        .from("social_posts")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("content_post_id", piece.id)
        // `SocialPlatform` no incluye Facebook (no se publica ahi): una pieza no tiene publicacion en esa red.
        .eq("platform", choice.network as never)
        .is("deleted_at", null)
        .limit(2);
      if (postsError) return { ok: false, error: "No pude comprobar la publicación" };
      if ((posts ?? []).length === 1) socialPostId = posts![0].id;
    }
    return { ok: true, choice: { ...choice, piece: { contentPostId: piece.id, socialPostId, title: piece.title } } };
  }

  if (choice.kind === "paid" && choice.ad) {
    let adId = refs.adId;
    let adsetId = refs.adsetId;
    let campaignId = refs.campaignId;

    if (adId) {
      const { data: ad, error } = await service.from("meta_ads").select("ad_id, adset_id, campaign_id").eq("workspace_id", workspaceId).eq("ad_id", adId).limit(1).maybeSingle();
      if (error) return { ok: false, error: "No pude comprobar el anuncio" };
      if (!ad) return { ok: false, error: "Ese anuncio no está en el catálogo de Meta" };
      adsetId = ad.adset_id ?? adsetId;
      campaignId = ad.campaign_id ?? campaignId;
    }
    if (adsetId) {
      const { data: adset, error } = await service.from("meta_adsets").select("adset_id, campaign_id").eq("workspace_id", workspaceId).eq("adset_id", adsetId).limit(1).maybeSingle();
      if (error) return { ok: false, error: "No pude comprobar el conjunto de anuncios" };
      if (!adset) return { ok: false, error: "Ese conjunto no está en el catálogo de Meta" };
      campaignId = adset.campaign_id ?? campaignId;
    }
    if (campaignId) {
      const { data: campaign, error } = await service.from("meta_campaigns").select("campaign_id").eq("workspace_id", workspaceId).eq("campaign_id", campaignId).limit(1).maybeSingle();
      if (error) return { ok: false, error: "No pude comprobar la campaña" };
      if (!campaign) return { ok: false, error: "Esa campaña no está en el catálogo de Meta" };
    }
    return { ok: true, choice: { ...choice, ad: { adId, adsetId, campaignId } } };
  }

  if (choice.kind === "referral") {
    if (refs.referrerContactId) {
      if (refs.referrerContactId === contactId) return { ok: false, error: "Un contacto no puede ser su propio referido" };
      const { data: referrer, error } = await service
        .from("contacts")
        .select("id")
        .eq("id", refs.referrerContactId)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) return { ok: false, error: "No pude comprobar quién lo recomendó" };
      if (!referrer) return { ok: false, error: "Ese contacto no existe" };
    }
    if (refs.referrerUserId) {
      const { data: member, error } = await service.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", refs.referrerUserId).maybeSingle();
      if (error) return { ok: false, error: "No pude comprobar quién lo recomendó" };
      if (!member) return { ok: false, error: "Esa persona no es parte del equipo" };
    }
  }

  return { ok: true, choice };
}

async function findStored(service: Db, workspaceId: string, dedupeKey: string): Promise<(StoredManualTouch & { id: string; channel: string | null }) | null> {
  const { data, error } = await service.from("contact_touches").select(STORED_COLUMNS).eq("workspace_id", workspaceId).eq("dedupe_key", dedupeKey).maybeSingle();
  if (error || !data) return null;
  return data as unknown as StoredManualTouch & { id: string; channel: string | null };
}

/**
 * Registra el toque de la venta y devuelve su id. Nunca lanza: un fallo vuelve como `{ ok: false }` con un mensaje
 * para mostrar (la venta no se crea sin su atribucion si la persona la pidio).
 */
export async function registerManualSaleTouch(service: Db, params: ManualTouchParams): Promise<ManualTouchResult> {
  try {
    const resolved = await resolveChoice(service, params.workspaceId, params.contactId, params.choice);
    if (!resolved.ok) return fail(resolved.error);

    let touch;
    try {
      touch = buildManualTouch(resolved.choice, { saleDate: params.saleDate, timeZone: params.timeZone, saleKey: params.saleKey });
    } catch (err) {
      return fail(err instanceof RangeError ? err.message : "No pude armar el toque");
    }

    // Primero con la clave simple; si ya existe con OTROS datos, con la clave de reintento.
    for (const attempt of [touch, { ...touch, dedupeKey: manualRetryKey(params.saleKey, touch) }]) {
      const recorded = await recordTouch(service, { workspaceId: params.workspaceId, contactId: params.contactId, touch: attempt });
      if (!recorded.recorded && recorded.reason !== "duplicate") return fail("No pude registrar de dónde vino la venta");

      const stored = await findStored(service, params.workspaceId, attempt.dedupeKey);
      if (!stored) return fail("No pude registrar de dónde vino la venta");
      // Uno recien creado es el nuestro (un trigger puede completarle la pieza). Uno que ya estaba tiene que decir
      // lo mismo que se quiere registrar: si no, es de una eleccion anterior de la misma venta.
      if (!recorded.recorded && !storedTouchMatches(stored, touch, params.contactId)) continue;

      if (params.choice.kind === "referral") await completeReferrer(service, params.workspaceId, params.contactId, params.choice);
      return { ok: true, touchId: stored.id, channel: stored.channel };
    }
    return fail("No pude registrar de dónde vino la venta");
  } catch (err) {
    console.error("[ventas] no pude registrar el toque de la venta:", err instanceof Error ? err.message : "error desconocido");
    return fail("No pude registrar de dónde vino la venta");
  }
}

/**
 * Si el contacto no tiene quien lo refirio (ni persona ni contacto), se completa con lo elegido: asi la asignacion
 * por referido y las demas pantallas ven el mismo dato. Nunca pisa uno que ya esta, y un fallo no frena la venta.
 */
async function completeReferrer(service: Db, workspaceId: string, contactId: string, choice: ManualChoice): Promise<void> {
  if (choice.kind !== "referral") return;
  const patch = choice.referrer.type === "contact" ? { referred_by_contact_id: choice.referrer.contactId } : { referred_by_user_id: choice.referrer.userId };
  try {
    const { error } = await service
      .from("contacts")
      .update(patch)
      .eq("id", contactId)
      .eq("workspace_id", workspaceId)
      .is("referred_by_user_id", null)
      .is("referred_by_contact_id", null);
    if (error) console.error("[ventas] no pude completar quién refirió al contacto:", error.message);
  } catch (err) {
    console.error("[ventas] no pude completar quién refirió al contacto:", err instanceof Error ? err.message : "error desconocido");
  }
}
