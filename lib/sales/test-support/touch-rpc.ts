/**
 * Una `record_contact_touch` en memoria para los tests de Ventas: inserta en `contact_touches` con la misma unicidad
 * `(workspace_id, dedupe_key)` que la base, y calcula el canal como el trigger (`touchChannel`). No es la funcion de
 * verdad (esa se prueba contra la base con `scripts/verify-*`), solo lo que Ventas necesita de ella.
 */
import type { MemoryDb } from "@/lib/agent/testing/memory-db";
import { touchChannel } from "@/lib/attribution/channel";

type Json = Record<string, unknown>;

export function memoryRecordTouch(args: Record<string, unknown>, db: MemoryDb): Json {
  const touch = args.p_touch as Json;
  const workspaceId = args.p_workspace_id as string;
  const contactId = args.p_contact_id as string;

  const contact = db.rows("contacts").find((c) => c.id === contactId && c.workspace_id === workspaceId && (c.deleted_at ?? null) === null);
  if (!contact) return { inserted: false, reason: "contact_not_found" };

  const rows = db.rows("contact_touches");
  if (rows.some((r) => r.workspace_id === workspaceId && r.dedupe_key === touch.dedupe_key)) return { inserted: false, reason: "duplicate" };

  // Como la base: la pieza solo se enlaza si existe en el workspace.
  const piece = typeof touch.content_post_id === "string" ? db.rows("content_posts").find((p) => p.id === touch.content_post_id && p.workspace_id === workspaceId) : undefined;
  const row: Json = {
    id: `touch-${rows.length + 1}`,
    workspace_id: workspaceId,
    contact_id: contactId,
    occurred_at: touch.occurred_at ?? new Date().toISOString(),
    source: touch.source ?? null,
    medium: touch.medium ?? null,
    campaign: touch.campaign ?? null,
    content_label: touch.content ?? null,
    term: touch.term ?? null,
    social_post_id: touch.social_post_id ?? null,
    content_post_id: piece ? piece.id : null,
    ad_id: touch.ad_id ?? null,
    adset_id: touch.adset_id ?? null,
    campaign_id: touch.campaign_id ?? null,
    origin: touch.origin,
    dedupe_key: touch.dedupe_key,
    raw: touch.raw ?? {},
  };
  row.channel = touchChannel({ origin: row.origin as string, medium: row.medium as string | null, source: row.source as string | null, ad_id: row.ad_id as string | null, adset_id: row.adset_id as string | null, campaign_id: row.campaign_id as string | null, social_post_id: row.social_post_id as string | null, content_post_id: row.content_post_id as string | null });
  rows.push(row);
  return { inserted: true, touch_id: row.id };
}
