/**
 * «Crear o actualizar contacto» (Extra L, F12–F14): el núcleo del paso, SOLO servidor.
 *
 * Aplica el mapeo, busca a la persona con `find_contact_for_form` (teléfono, email y redes; NUNCA por
 * nombre), la crea o la actualiza según la política, suma tags y campos personalizados, anota el toque y
 * deja el historial. Escribe con el cliente de SERVICIO y siempre sobre el `workspace_id` del endpoint
 * (nunca el del payload).
 *
 * Reglas que no se discuten:
 *  - Sin teléfono, email ni red => «No se pudo» (`no_identifier`); nada se crea.
 *  - `fill_empty` solo completa lo vacío; `overwrite` pisa lo mapeado. Los tags siempre se suman.
 *  - El @ de Instagram de un contacto con un canal de Instagram vinculado NUNCA se pisa.
 *  - Un identificador que ya es de OTRO contacto (`conflicts`) no se escribe y nada se fusiona.
 *  - La atribución nunca tumba nada: el toque va en `try/catch` (`recordTouch` no lanza).
 *  - Un fallo interno de base SÍ lanza: el envío queda `error` y se puede reprocesar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { auditAsWebhook } from "@/lib/audit";
import { recordTouch } from "@/lib/contacts/touch";
import { manualTouch } from "@/lib/contacts/touch-entry";
import { countryFromTimezone } from "@/lib/scheduling/phone-countries";
import type { CustomFieldDef } from "@/lib/forms/contact-config";
import { diffFields, type FieldDiff } from "./diff";
import { effectiveAttribution, buildWebhookTouch } from "./attribution";
import { applyContactMapping, hasIdentifier, type MappedContactColumns, type MappingResult } from "./mapping";
import type { UpsertContactConfig } from "./upsert-config";
import type { ContactResult } from "./types";

type Db = SupabaseClient<Database>;

export interface UpsertArgs {
  db: Db;
  workspaceId: string;
  config: UpsertContactConfig;
  webhook: { inboundId: string; endpointId: string; endpointName: string; payload: unknown; query: unknown };
  nodeId: string;
}

export type FailReason = "no_identifier" | "not_found";

export interface UpsertSuccess {
  ok: true;
  contactId: string;
  contactName: string;
  result: ContactResult;
  diff: FieldDiff;
  conflict: { contact_id: string; by: string }[] | null;
  touch: { recorded: boolean; source: string; medium: string | null; campaign: string | null; content: string | null; ad_id: string | null } | null;
  /** Lo que no se pudo guardar (un país o un usuario que no se reconoce, un tag que no existe). */
  notes: string[];
}
export type UpsertOutcome = UpsertSuccess | { ok: false; reason: FailReason; notes: string[] };

const COLUMNS = ["display_name", "email", "phone", "whatsapp_phone", "country", "instagram_username", "tiktok_username", "twitter_username", "linkedin_profile_url", "facebook_id", "youtube_channel_id"] as const;
type Column = (typeof COLUMNS)[number];

const CONTACT_SELECT = ["id", "created_at", ...COLUMNS].join(", ");
type ContactRow = { id: string; created_at: string } & Record<Column, string | null>;

const isEmpty = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === "";

/** El conflicto de identidad que reporta `find_contact_for_form`: por qué dato y con qué contacto. */
interface Found {
  contactId: string | null;
  matchedBy: string | null;
  conflicts: { by: string; contact_id: string }[];
}

async function findContact(db: Db, workspaceId: string, mapped: MappedContactColumns): Promise<Found> {
  const social = Object.fromEntries(
    Object.entries({ instagram: mapped.instagram_username, tiktok: mapped.tiktok_username, x: mapped.twitter_username, linkedin: mapped.linkedin_profile_url }).filter(([, v]) => !!v),
  );
  const probe = async (phone: string | null): Promise<Found> => {
    const { data, error } = await db.rpc("find_contact_for_form", { p_workspace_id: workspaceId, p_phone: (phone ?? null) as never, p_email: (mapped.email ?? null) as never, p_social: social as Json });
    if (error) throw new Error(`no pude buscar el contacto: ${error.message}`);
    const r = (data ?? {}) as { contact_id?: string | null; matched_by?: string | null; conflicts?: { by: string; contact_id: string }[] };
    return { contactId: r.contact_id ?? null, matchedBy: r.matched_by ?? null, conflicts: Array.isArray(r.conflicts) ? r.conflicts : [] };
  };

  const phones = [mapped.phone, mapped.whatsapp_phone].filter((p): p is string => !!p);
  const candidates: (string | null)[] = [];
  for (const p of phones) {
    candidates.push(p);
    // Un teléfono guardado sin el «+» (de antes de normalizar): se prueba también sin él.
    if (p.startsWith("+")) candidates.push(p.slice(1));
  }
  if (candidates.length === 0) candidates.push(null);

  let last: Found = { contactId: null, matchedBy: null, conflicts: [] };
  for (const phone of [...new Set(candidates)]) {
    last = await probe(phone);
    if (last.contactId) return last;
  }
  return last;
}

/** Quien llama lo trata como `created | updated | unchanged` y arma con eso el resultado del envío. */
export async function upsertContactFromWebhook(args: UpsertArgs): Promise<UpsertOutcome> {
  const { db, workspaceId, config, webhook, nodeId } = args;
  const notes: string[] = [];

  const [{ data: ws }, { data: defs }] = await Promise.all([
    db.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle(),
    db.from("custom_field_definitions").select("id, slug, name, type").eq("workspace_id", workspaceId).is("deleted_at", null),
  ]);
  const customFields = ((defs ?? []) as unknown as CustomFieldDef[]);
  const mapping: MappingResult = applyContactMapping(webhook.payload, webhook.query, config, {
    defaultCountry: countryFromTimezone((ws as { timezone?: string } | null)?.timezone) ?? null,
    customFields,
  });
  for (const e of mapping.errors) notes.push(`${e.target}:${e.reason}`);

  if (!hasIdentifier(mapping.contact)) return { ok: false, reason: "no_identifier", notes };

  let found = await findContact(db, workspaceId, mapping.contact);
  let contactId = found.contactId;
  let created = false;
  let existing: ContactRow | null = null;

  if (contactId) {
    existing = await loadContact(db, workspaceId, contactId);
    if (!existing) contactId = null; // se borró entre la búsqueda y la lectura: se trata como nuevo
  }

  const diff: FieldDiff = {};

  if (!contactId) {
    if (config.mode === "update_only") return { ok: false, reason: "not_found", notes };
    const inserted = await insertContact(db, workspaceId, mapping.contact);
    if (inserted.raceWith) {
      // Otro envío creó a la misma persona en el medio: se vuelve a buscar y se trata como existente.
      found = await findContact(db, workspaceId, mapping.contact);
      contactId = found.contactId;
      existing = contactId ? await loadContact(db, workspaceId, contactId) : null;
      if (!existing) throw new Error("no pude crear ni encontrar el contacto");
    } else {
      contactId = inserted.id;
      created = true;
      for (const [k, v] of Object.entries(mapping.contact)) diff[k] = { before: null, after: v };
    }
  }

  const finalId = contactId as string;

  if (!created && existing) {
    const patch = buildPatch(existing, mapping.contact, config.update === "overwrite", found.conflicts, await hasInstagramChannel(db, finalId));
    if (Object.keys(patch).length > 0) {
      const { error } = await db.from("contacts").update({ ...patch, last_interaction_at: new Date().toISOString() } as never).eq("id", finalId).eq("workspace_id", workspaceId);
      if (error) throw new Error(`no pude actualizar el contacto: ${error.message}`);
      Object.assign(diff, diffFields(existing as unknown as Record<string, unknown>, { ...existing, ...patch } as Record<string, unknown>));
    } else {
      await db.from("contacts").update({ last_interaction_at: new Date().toISOString() } as never).eq("id", finalId).eq("workspace_id", workspaceId);
    }
  }

  // Campos personalizados.
  Object.assign(diff, await writeCustomFields(db, finalId, customFields, mapping.custom, config.update === "overwrite", created));
  // Tags (siempre se suman).
  const tagResult = await addTags(db, workspaceId, finalId, config.tags.fixed, mapping.tagNames);
  notes.push(...tagResult.notes);
  if (tagResult.added.length > 0) diff.tags = { before: null, after: tagResult.added.join(", ") };

  const contactName = created ? (mapping.contact.display_name ?? mapping.contact.email ?? mapping.contact.phone ?? mapping.contact.whatsapp_phone ?? finalId) : (existing?.display_name ?? mapping.contact.display_name ?? mapping.contact.email ?? finalId);

  const touch = await recordWebhookTouch({ args, mapping, contactId: finalId, existing: created ? null : existing });

  // Historial del contacto: quien lo creó o actualizó fue el webhook.
  const result: ContactResult = created ? "created" : Object.keys(diff).length > 0 ? "updated" : "unchanged";
  // Un conflicto de identidad (el telefono de uno y el email de otro) deja una nota en el historial del
  // contacto aunque no haya cambiado nada, igual que Formularios lo muestra en la respuesta.
  if (result !== "unchanged" || found.conflicts.length > 0) {
    await auditAsWebhook({
      supabase: db as never,
      workspaceId,
      entityType: "contact",
      entityId: finalId,
      action: created ? "contact.created" : result === "updated" ? "contact.updated" : "contact.linked",
      label: `Webhook «${webhook.endpointName}»`,
      changes: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, { old: (v.before ?? null) as Json, new: (v.after ?? null) as Json }])),
      metadata: { source: "webhook", endpoint_id: webhook.endpointId, inbound_id: webhook.inboundId, node_id: nodeId, ...(found.conflicts.length > 0 ? { conflicts: found.conflicts as unknown as Json } : {}) },
    });
  }

  return {
    ok: true,
    contactId: finalId,
    contactName,
    result,
    diff,
    conflict: found.conflicts.length > 0 ? found.conflicts : null,
    touch,
    notes,
  };
}

async function loadContact(db: Db, workspaceId: string, id: string): Promise<ContactRow | null> {
  const { data, error } = await db.from("contacts").select(CONTACT_SELECT).eq("workspace_id", workspaceId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`no pude leer el contacto: ${error.message}`);
  // Una copia: quien llama compara contra esto despues de escribir.
  return data ? ({ ...(data as unknown as ContactRow) } as ContactRow) : null;
}

async function hasInstagramChannel(db: Db, contactId: string): Promise<boolean> {
  const { data } = await db.from("contact_channels").select("channels!inner(platform)").eq("contact_id", contactId).eq("channels.platform", "instagram").limit(1);
  return (data ?? []).length > 0;
}

/** Los identificadores que ya son de otro contacto: no se escriben en este. */
function conflictedColumns(conflicts: { by: string }[]): Set<Column> {
  const out = new Set<Column>();
  for (const c of conflicts) {
    if (c.by === "phone") (out.add("phone"), out.add("whatsapp_phone"));
    if (c.by === "email") out.add("email");
    if (c.by === "instagram") out.add("instagram_username");
    if (c.by === "tiktok") out.add("tiktok_username");
    if (c.by === "x") out.add("twitter_username");
    if (c.by === "linkedin") out.add("linkedin_profile_url");
  }
  return out;
}

/** Qué columnas cambian: `fill_empty` solo las vacías; `overwrite` todas las mapeadas. */
export function buildPatch(current: Record<Column, string | null>, mapped: MappedContactColumns, overwrite: boolean, conflicts: { by: string }[], hasInstagramChannelLinked: boolean): Partial<Record<Column, string>> {
  const skip = conflictedColumns(conflicts);
  const patch: Partial<Record<Column, string>> = {};
  for (const column of COLUMNS) {
    const value = mapped[column];
    if (isEmpty(value) || skip.has(column)) continue;
    // El @ de un contacto con canal de Instagram lo mantiene la conversación real: ni con overwrite.
    if (column === "instagram_username" && hasInstagramChannelLinked) continue;
    if (!overwrite && !isEmpty(current[column])) continue;
    if (current[column] === value) continue;
    patch[column] = value as string;
  }
  return patch;
}

async function insertContact(db: Db, workspaceId: string, mapped: MappedContactColumns): Promise<{ id: string; raceWith?: false } | { id?: never; raceWith: true }> {
  // Sin nombre se usa el email o el teléfono; con solo un usuario de red, el usuario hace de nombre ("@ana").
  const handle = mapped.instagram_username ?? mapped.tiktok_username ?? mapped.twitter_username;
  const name = mapped.display_name ?? mapped.email ?? mapped.phone ?? mapped.whatsapp_phone ?? (handle ? `@${handle}` : mapped.linkedin_profile_url ?? null);
  const { data, error } = await db
    .from("contacts")
    .insert({ workspace_id: workspaceId, ...mapped, display_name: name, last_interaction_at: new Date().toISOString() } as never)
    .select("id")
    .single();
  if (error) {
    // 23505: otro envío creó a la misma persona justo antes (índice único por email o teléfono).
    if (error.code === "23505") return { raceWith: true };
    throw new Error(`no pude crear el contacto: ${error.message}`);
  }
  return { id: (data as { id: string }).id };
}

async function writeCustomFields(db: Db, contactId: string, defs: CustomFieldDef[], values: Record<string, string>, overwrite: boolean, isNew: boolean): Promise<FieldDiff> {
  const diff: FieldDiff = {};
  const entries = Object.entries(values);
  if (entries.length === 0) return diff;
  const bySlug = new Map(defs.map((d) => [d.slug, d]));
  const { data: current } = await db.from("contact_custom_fields").select("field_id, value").eq("contact_id", contactId);
  const currentByField = new Map(((current ?? []) as { field_id: string; value: string | null }[]).map((r) => [r.field_id, r.value]));

  for (const [slug, value] of entries) {
    const def = bySlug.get(slug);
    if (!def) continue;
    const before = currentByField.get(def.id) ?? null;
    if (!isNew && !overwrite && !isEmpty(before)) continue;
    if (before === value) continue;
    const { error } = await db.from("contact_custom_fields").upsert({ contact_id: contactId, field_id: def.id, value } as never, { onConflict: "contact_id,field_id" });
    if (error) throw new Error(`no pude guardar el campo ${slug}: ${error.message}`);
    diff[`custom.${slug}`] = { before, after: value };
  }
  return diff;
}

async function addTags(db: Db, workspaceId: string, contactId: string, fixedIds: string[], names: string[]): Promise<{ added: string[]; notes: string[] }> {
  const notes: string[] = [];
  if (fixedIds.length === 0 && names.length === 0) return { added: [], notes };
  const { data } = await db.from("tags").select("id, name").eq("workspace_id", workspaceId);
  const tags = (data ?? []) as { id: string; name: string }[];
  const wanted = new Map<string, string>();
  for (const id of fixedIds) {
    const t = tags.find((x) => x.id === id);
    if (t) wanted.set(t.id, t.name);
  }
  for (const name of names) {
    const t = tags.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (t) wanted.set(t.id, t.name);
    else notes.push(`tag_inexistente:${name}`);
  }
  if (wanted.size === 0) return { added: [], notes };

  const { data: have } = await db.from("contact_tags").select("tag_id").eq("contact_id", contactId);
  const haveIds = new Set(((have ?? []) as { tag_id: string }[]).map((r) => r.tag_id));
  const toAdd = [...wanted.entries()].filter(([id]) => !haveIds.has(id));
  if (toAdd.length === 0) return { added: [], notes };
  const { error } = await db.from("contact_tags").upsert(toAdd.map(([tag_id]) => ({ contact_id: contactId, tag_id })) as never, { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
  if (error) throw new Error(`no pude sumar los tags: ${error.message}`);
  return { added: toAdd.map(([, name]) => name), notes };
}

/**
 * El toque del envío (siempre que el paso termine en «Listo»). Un contacto que ya existía y no tenía
 * ningún toque (importado o cargado a mano) recibe ANTES un toque ancla «manual» fechado en su alta:
 * así el webhook queda como el ÚLTIMO y el primero sigue siendo el origen que ya se conocía. Nunca lanza.
 */
async function recordWebhookTouch(input: { args: UpsertArgs; mapping: MappingResult; contactId: string; existing: ContactRow | null }) {
  const { args, mapping, contactId, existing } = input;
  try {
    if (existing) {
      const { count } = await args.db.from("contact_touches").select("id", { count: "exact", head: true }).eq("contact_id", contactId);
      if ((count ?? 0) === 0) {
        await recordTouch(args.db, { workspaceId: args.workspaceId, contactId, touch: { ...manualTouch(contactId, null), occurredAt: existing.created_at } });
      }
    }
    const attribution = effectiveAttribution({ payload: args.webhook.payload, query: args.webhook.query, mapped: mapping.attribution, autoDetect: args.config.attribution.autoDetect });
    const touch = buildWebhookTouch({ attribution, touchMedium: args.config.touchMedium, inboundId: args.webhook.inboundId, nodeId: args.nodeId, endpointId: args.webhook.endpointId, endpointName: args.webhook.endpointName });
    const recorded = await recordTouch(args.db, { workspaceId: args.workspaceId, contactId, touch });
    return { recorded: recorded.recorded, source: touch.source, medium: touch.medium ?? null, campaign: touch.campaign ?? null, content: touch.content ?? null, ad_id: touch.adId ?? null };
  } catch (err) {
    console.error("[webhooks] no pude anotar el toque:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
