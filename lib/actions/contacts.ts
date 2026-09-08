"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import { validateContactInput, type ContactPatch } from "@/lib/contacts/fields";
import { mergeAttribution, parseTrackingParams } from "@/lib/contacts/attribution";
import { findDuplicateContact } from "@/lib/contacts/dedup";
import type { Json } from "@/lib/types/database";

/**
 * Server Actions de contactos.
 *
 * Cuatro reglas que valen para todas:
 *
 * 1. El input se revalida ACA aunque el formulario ya lo haya validado. La
 *    validacion del cliente es para avisar mientras se escribe; la barrera
 *    real es esta, mas la RLS.
 * 2. Toda consulta lleva .eq("workspace_id", ...) explicito ademas de la RLS.
 *    Si alguna vez una policy se afloja por error, esto sigue conteniendo.
 * 3. El scope de leads lo aplica la base (can_see_contact, migracion 00024).
 *    Por eso no hace falta chequear "es mi lead" en el codigo: si un Member
 *    manda el id de un contacto ajeno, el UPDATE afecta cero filas.
 * 4. Cada mutacion deja su entrada en audit_log. Si el registro falla, la
 *    operacion NO falla: el historial es evidencia, no una precondicion.
 */

const LIST_PATH = "/dashboard/contacts";

/** Tope de las notas del contacto. Es texto libre, pero no un documento. */
const MAX_NOTES = 10000;

/** Tope del nombre de un tag: es una etiqueta, no una frase. */
const MAX_TAG_NAME = 40;
const contactPath = (id: string) => `/dashboard/contacts/${id}`;

export type ContactActionResult =
  | { ok: true; contactId?: string }
  | { ok: false; error: string };

function revalidateContact(id: string) {
  revalidatePath(LIST_PATH);
  revalidatePath(contactPath(id));
}

// ------------------------------------------------------------------
// Alta
// ------------------------------------------------------------------

/**
 * Crea un contacto a mano desde la UI.
 *
 * Deduplica igual que el webhook: si ya hay uno con el mismo telefono o email
 * en el workspace, no crea un duplicado — devuelve el que ya existe para que
 * la UI lleve ahi. Nunca deduplica por nombre.
 */
export type CreateContactResult =
  | { ok: true; contactId: string }
  | { ok: false; error: string; contactId?: string; duplicate?: boolean };

export async function createContact(
  input: Record<string, unknown>,
): Promise<CreateContactResult> {
  const { workspace, supabase, user } = await getWorkspace();

  const validated = validateContactInput(input);
  if (!validated.ok) return validated;

  const patch = validated.patch;

  if (!patch.display_name && !patch.email && !patch.phone) {
    return { ok: false, error: "Poné al menos un nombre, un email o un telefono" };
  }

  // Deduplicacion por dato fuerte, la misma que usa la importacion de CSV.
  const existing = await findDuplicateContact({
    supabase,
    workspaceId: workspace.id,
    phones: [patch.phone, patch.whatsapp_phone],
    emails: [patch.email, patch.secondary_email],
  });

  if (existing) {
    return {
      ok: false,
      error: "Ya existe un contacto con ese telefono o email. Te llevo a su ficha.",
      contactId: existing.id as string,
      duplicate: true,
    };
  }

  const attribution = mergeAttribution({}, parseTrackingParams(input));

  const { data, error } = await supabase
    .from("contacts")
    .insert({ workspace_id: workspace.id, ...patch, attribution: attribution as Json })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[contacts] alta fallida:", error?.message);
    return { ok: false, error: `No pude crear el contacto: ${error?.message ?? "error desconocido"}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact", entityId: data.id,
    action: "create", metadata: { source: "manual" }, performedBy: user.id,
  });

  revalidateContact(data.id);
  return { ok: true, contactId: data.id };
}

// ------------------------------------------------------------------
// Edicion
// ------------------------------------------------------------------

export async function updateContact(
  contactId: string,
  input: Record<string, unknown>,
): Promise<ContactActionResult> {
  const { workspace, supabase, user } = await getWorkspace();

  const validated = validateContactInput(input);
  if (!validated.ok) return validated;
  if (Object.keys(validated.patch).length === 0) return { ok: true, contactId };

  return applyPatch({
    supabase, workspaceId: workspace.id, userId: user.id,
    contactId, patch: validated.patch, action: "update",
  });
}

/** Asignacion de setter y vendedor (F11). Independientes: se puede mandar una sola. */
export async function assignContact(
  contactId: string,
  assignment: { setter_id?: string | null; vendedor_id?: string | null },
): Promise<ContactActionResult> {
  const { workspace, supabase, user } = await getWorkspace();

  const patch: Record<string, string | null> = {};
  for (const key of ["setter_id", "vendedor_id"] as const) {
    if (!(key in assignment)) continue;
    const value = assignment[key] ?? null;
    if (!value) {
      patch[key] = null;
      continue;
    }
    // Solo miembros del workspace: sin esto se podria asignar un lead a
    // cualquier uuid y dejarlo invisible para todo el equipo.
    const { data: member } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspace.id)
      .eq("user_id", value)
      .maybeSingle();

    if (!member) return { ok: false, error: "Esa persona no es miembro del workspace" };
    patch[key] = value;
  }

  if (Object.keys(patch).length === 0) return { ok: true, contactId };

  return applyPatch({
    supabase, workspaceId: workspace.id, userId: user.id,
    contactId, patch, action: "assign",
  });
}

/** Marca o saca la marca de "no contactar" (F18; la deteccion automatica es del Bloque 4). */
export async function setDoNotContact(
  contactId: string,
  value: boolean,
  reason?: string | null,
): Promise<ContactActionResult> {
  const { workspace, supabase, user } = await getWorkspace();

  // Sacar la marca es decision de Owner/Admin: si cualquiera pudiera
  // revertirla, la marca no protegeria de nada.
  if (!value) {
    const admin = await getAdminContext();
    if (!admin) {
      return { ok: false, error: "Solo Owner y Admin pueden sacar la marca de no contactar" };
    }
  }

  const patch = {
    do_not_contact: value,
    do_not_contact_reason: value ? (reason?.trim() || "manual") : null,
    do_not_contact_at: value ? new Date().toISOString() : null,
  };

  return applyPatch({
    supabase, workspaceId: workspace.id, userId: user.id,
    contactId, patch, action: "do_not_contact",
  });
}

// ------------------------------------------------------------------
// Borrado logico (F15)
// ------------------------------------------------------------------

/** Marca el contacto como borrado. A los 30 dias lo purga el cron. */
export async function softDeleteContact(contactId: string): Promise<ContactActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden eliminar contactos" };

  const { workspace, supabase, user } = ctx;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("contacts")
    .update({ deleted_at: now })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);

  if (error) {
    console.error("[contacts] borrado fallido:", error.message);
    return { ok: false, error: `No pude eliminar el contacto: ${error.message}` };
  }

  // Las conversaciones acompañan al contacto: si no, quedan hilos en la
  // bandeja apuntando a alguien que ya no esta en la lista.
  await supabase
    .from("conversations")
    .update({ deleted_at: now })
    .eq("contact_id", contactId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact", entityId: contactId,
    action: "delete", metadata: { retention_days: 30 }, performedBy: user.id,
  });

  revalidateContact(contactId);
  return { ok: true, contactId };
}

/** Deshace el borrado mientras el cron no lo haya purgado. */
export async function restoreContact(contactId: string): Promise<ContactActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden restaurar contactos" };

  const { workspace, supabase, user } = ctx;

  // La policy de SELECT esconde los borrados, asi que el UPDATE se hace a
  // ciegas por id + workspace. El USING del UPDATE no filtra deleted_at
  // justamente para que esto sea posible.
  const { error } = await supabase
    .from("contacts")
    .update({ deleted_at: null })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[contacts] restauracion fallida:", error.message);
    return { ok: false, error: `No pude restaurar el contacto: ${error.message}` };
  }

  await supabase
    .from("conversations")
    .update({ deleted_at: null })
    .eq("contact_id", contactId)
    .eq("workspace_id", workspace.id);

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact", entityId: contactId,
    action: "restore", performedBy: user.id,
  });

  revalidateContact(contactId);
  return { ok: true, contactId };
}

// ------------------------------------------------------------------
// Tags y custom fields
// ------------------------------------------------------------------

/**
 * Crea un tag y se lo asigna al contacto, en un paso (F5).
 *
 * Antes solo se podian asignar tags que ya existieran, y los tags solo nacian
 * desde la importacion de CSV o cuando corria un nodo de un flow. O sea que
 * para etiquetar un lead con algo nuevo habia que importar un CSV.
 *
 * Lo puede hacer cualquiera que pueda editar el contacto, no solo Owner/Admin.
 * Es lo mismo que ya pasa con la importacion de CSV, que crea tags y la puede
 * correr un Member; pedir permiso de admin aca y no alla seria incoherente.
 *
 * El nombre se compara sin distinguir mayusculas, igual que lo hace el
 * importador: sin eso, "VIP" desde la ficha y "vip" desde un CSV serian dos
 * tags que el importador trata como uno solo.
 */
export async function createAndAssignTag(
  contactId: string,
  rawName: string,
): Promise<ContactActionResult> {
  const { workspace, supabase, user } = await getWorkspace();

  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "El tag necesita un nombre" };
  if (name.length > MAX_TAG_NAME) {
    return { ok: false, error: `El nombre es muy largo (maximo ${MAX_TAG_NAME} caracteres)` };
  }

  // La consulta pasa por la RLS: si el scope de leads no deja ver ese lead, no
  // vuelve nada y no se crea ningun tag.
  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!contact) return { ok: false, error: "No encontre ese contacto" };

  const { data: existing } = await supabase
    .from("tags")
    .select("id, name")
    .eq("workspace_id", workspace.id)
    .ilike("name", name)
    .limit(1)
    .maybeSingle();

  let tagId = existing?.id;

  if (!tagId) {
    const { data: created, error } = await supabase
      .from("tags")
      .insert({ workspace_id: workspace.id, name })
      .select("id")
      .single();

    if (error || !created) {
      // 23505: alguien lo creo entre la consulta y el insert. No es un error
      // para quien esta etiquetando: el tag existe, que era el objetivo.
      if (error?.code === "23505") {
        const { data: ganador } = await supabase
          .from("tags")
          .select("id")
          .eq("workspace_id", workspace.id)
          .ilike("name", name)
          .limit(1)
          .maybeSingle();
        tagId = ganador?.id;
      }

      if (!tagId) {
        console.error("[contacts] no pude crear el tag:", error?.message);
        return { ok: false, error: `No pude crear el tag: ${error?.message ?? "error desconocido"}` };
      }
    } else {
      tagId = created.id;
    }
  }

  const { error: linkError } = await supabase
    .from("contact_tags")
    .upsert({ contact_id: contactId, tag_id: tagId }, { onConflict: "contact_id,tag_id", ignoreDuplicates: true });

  if (linkError) {
    console.error("[contacts] no pude asignar el tag:", linkError.message);
    return { ok: false, error: `El tag se creo pero no pude asignarlo: ${linkError.message}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact", entityId: contactId,
    action: "update",
    metadata: { tag: name, created: !existing },
    performedBy: user.id,
  });

  revalidateContact(contactId);
  return { ok: true, contactId };
}

export async function setContactTags(
  contactId: string,
  tagIds: string[],
): Promise<ContactActionResult> {
  const { workspace, supabase, user } = await getWorkspace();

  // Solo tags de este workspace: sin esto se podrian pegar tags de otro.
  const { data: valid } = await supabase
    .from("tags")
    .select("id")
    .eq("workspace_id", workspace.id)
    .in("id", tagIds.length > 0 ? tagIds : ["00000000-0000-0000-0000-000000000000"]);

  const allowed = new Set((valid ?? []).map((t) => t.id));
  const wanted = tagIds.filter((id) => allowed.has(id));

  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!contact) return { ok: false, error: "No encontre ese contacto" };

  const { data: current } = await supabase
    .from("contact_tags")
    .select("tag_id")
    .eq("contact_id", contactId);

  const currentIds = new Set((current ?? []).map((t) => t.tag_id));
  const toAdd = wanted.filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !wanted.includes(id));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("contact_tags")
      .insert(toAdd.map((tag_id) => ({ contact_id: contactId, tag_id })));
    if (error) {
      console.error("[contacts] no pude agregar tags:", error.message);
      return { ok: false, error: `No pude agregar los tags: ${error.message}` };
    }
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("contact_tags")
      .delete()
      .eq("contact_id", contactId)
      .in("tag_id", toRemove);
    if (error) {
      console.error("[contacts] no pude quitar tags:", error.message);
      return { ok: false, error: `No pude quitar los tags: ${error.message}` };
    }
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    await logAudit({
      supabase, workspaceId: workspace.id, entityType: "contact", entityId: contactId,
      action: "update", changes: { tags: { old: [...currentIds].join(",") || null, new: wanted.join(",") || null } },
      performedBy: user.id,
    });
  }

  revalidateContact(contactId);
  return { ok: true, contactId };
}

/**
 * Notas del contacto (F3).
 *
 * Un solo campo de texto, no una tabla de notas. Lo que se pierde respecto del
 * modelo anterior —autor y fecha por nota— queda en el audit log, que registra
 * quien cambio el texto y de que a que.
 *
 * Se manda el texto que se tenia cargado al abrir: si otra persona lo cambio
 * mientras tanto, se rechaza en vez de pisarlo. Es un campo compartido y el
 * pisado silencioso es la forma mas facil de perder lo que alguien escribio.
 */
export async function updateContactNotes(
  contactId: string,
  notes: string,
  previous: string | null,
): Promise<ContactActionResult> {
  const { workspace, supabase, user } = await getWorkspace();

  const text = notes.trim();
  if (text.length > MAX_NOTES) {
    return { ok: false, error: `Las notas son muy largas (maximo ${MAX_NOTES} caracteres)` };
  }

  // La consulta pasa por la RLS: si el scope de leads no deja ver ese lead, no
  // vuelve nada y no se escribe.
  const { data: actual } = await supabase
    .from("contacts")
    .select("id, notes")
    .eq("id", contactId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!actual) return { ok: false, error: "No encontre ese contacto" };

  const enBase = (actual.notes ?? "").trim();
  if (enBase !== (previous ?? "").trim()) {
    return {
      ok: false,
      error: "Alguien mas cambio las notas mientras las editabas. Recargá la ficha para ver lo que quedó.",
    };
  }

  if (enBase === text) return { ok: true, contactId };

  const { error } = await supabase
    .from("contacts")
    .update({ notes: text || null })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[contacts] no pude guardar las notas:", error.message);
    return { ok: false, error: `No pude guardar las notas: ${error.message}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact", entityId: contactId,
    action: "update", changes: { notes: { old: enBase || null, new: text || null } },
    performedBy: user.id,
  });

  revalidateContact(contactId);
  return { ok: true, contactId };
}

export async function setContactCustomField(
  contactId: string,
  fieldId: string,
  value: string,
): Promise<ContactActionResult> {
  const { workspace, supabase, user } = await getWorkspace();

  const { data: field } = await supabase
    .from("custom_field_definitions")
    .select("id, name")
    .eq("id", fieldId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!field) return { ok: false, error: "Ese campo personalizado no existe en este workspace" };

  const clean = value.trim();

  // El valor es NOT NULL en la tabla, asi que "vaciar" un campo es borrar la
  // fila, no guardar un string vacio.
  const { error } = clean
    ? await supabase
        .from("contact_custom_fields")
        .upsert({ contact_id: contactId, field_id: fieldId, value: clean, updated_at: new Date().toISOString() },
                { onConflict: "contact_id,field_id" })
    : await supabase
        .from("contact_custom_fields")
        .delete()
        .eq("contact_id", contactId)
        .eq("field_id", fieldId);

  if (error) {
    console.error("[contacts] custom field fallido:", error.message);
    return { ok: false, error: `No pude guardar "${field.name}": ${error.message}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact", entityId: contactId,
    action: "update", changes: { [`custom:${field.name}`]: { old: null, new: clean || null } },
    performedBy: user.id,
  });

  revalidateContact(contactId);
  return { ok: true, contactId };
}

// ------------------------------------------------------------------
// Vinculacion de duplicados (F12)
// ------------------------------------------------------------------

/**
 * Une un contacto duplicado con el principal.
 *
 * No es un merge destructivo: los canales, conversaciones y notas del
 * duplicado pasan al principal, los campos vacios del principal se completan
 * con los del duplicado (nunca al reves), y el duplicado queda con borrado
 * logico. Como es reversible durante 30 dias, si la vinculacion estuvo mal se
 * puede restaurar.
 *
 * Es Owner/Admin porque implica borrar (logicamente) un contacto.
 */
export async function linkContacts(
  duplicateId: string,
  mainId: string,
): Promise<ContactActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden vincular contactos" };
  if (duplicateId === mainId) return { ok: false, error: "Es el mismo contacto" };

  const { workspace, supabase, user } = ctx;

  const { data: pair } = await supabase
    .from("contacts")
    .select("*")
    .eq("workspace_id", workspace.id)
    .in("id", [duplicateId, mainId])
    .is("deleted_at", null);

  const main = pair?.find((c) => c.id === mainId);
  const duplicate = pair?.find((c) => c.id === duplicateId);
  if (!main || !duplicate) return { ok: false, error: "No encontre alguno de los dos contactos" };

  // Los campos de identidad que el principal tiene vacios se completan con los
  // del duplicado. Lo que el principal ya tiene cargado no se pisa nunca.
  const FILLABLE = [
    "display_name", "email", "secondary_email", "phone", "whatsapp_phone", "country",
    "instagram_username", "tiktok_username", "twitter_username", "facebook_id",
    "youtube_channel_id", "linkedin_profile_url", "setter_id", "vendedor_id",
  ] as const;

  const fill: Record<string, unknown> = {};
  for (const key of FILLABLE) {
    if (!main[key] && duplicate[key]) fill[key] = duplicate[key];
  }

  // Una conversacion por canal: conversations es unique (channel_id, contact_id).
  // Si el principal ya tiene una en ese canal, la del duplicado se queda donde
  // esta y se va con el borrado logico; mover la romperia el indice.
  const { data: mainConvs } = await supabase
    .from("conversations")
    .select("channel_id")
    .eq("contact_id", mainId);
  const takenChannels = new Set((mainConvs ?? []).map((c) => c.channel_id));

  const { data: dupConvs } = await supabase
    .from("conversations")
    .select("id, channel_id")
    .eq("contact_id", duplicateId);

  const movableConvs = (dupConvs ?? []).filter((c) => !takenChannels.has(c.channel_id));
  const skipped = (dupConvs ?? []).length - movableConvs.length;

  if (movableConvs.length > 0) {
    await supabase
      .from("conversations")
      .update({ contact_id: mainId })
      .in("id", movableConvs.map((c) => c.id));
  }

  // contact_channels es unique por (channel_id, platform_sender_id), y los
  // sender id son distintos justamente porque son dos contactos: no colisiona.
  await supabase.from("contact_channels").update({ contact_id: mainId }).eq("contact_id", duplicateId);
  // Las notas de los dos se juntan. Es el unico campo del merge donde "lo que
  // ya estaba gana" seria una perdida: son dos textos que escribieron personas
  // distintas sobre el mismo lead, y quedarse con uno tira el otro.
  const notasUnidas = [main.notes, duplicate.notes]
    .map((n) => (n ?? "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n");

  if (notasUnidas && notasUnidas !== (main.notes ?? "").trim()) {
    await supabase.from("contacts").update({ notes: notasUnidas }).eq("id", mainId);
  }

  // contact_tags tiene PK (contact_id, tag_id): los tags repetidos chocarian,
  // asi que se mueven solo los que el principal no tiene.
  const { data: mainTags } = await supabase.from("contact_tags").select("tag_id").eq("contact_id", mainId);
  const owned = new Set((mainTags ?? []).map((t) => t.tag_id));
  const { data: dupTags } = await supabase.from("contact_tags").select("tag_id").eq("contact_id", duplicateId);
  const movableTags = (dupTags ?? []).map((t) => t.tag_id).filter((id) => !owned.has(id));
  if (movableTags.length > 0) {
    await supabase.from("contact_tags").update({ contact_id: mainId })
      .eq("contact_id", duplicateId).in("tag_id", movableTags);
  }

  if (Object.keys(fill).length > 0) {
    await supabase.from("contacts").update(fill).eq("id", mainId).eq("workspace_id", workspace.id);
  }

  // El duplicado sale de circulacion y deja de ofrecer la sugerencia.
  const now = new Date().toISOString();
  await supabase.from("contacts")
    .update({ deleted_at: now, metadata: { merged_into: mainId } })
    .eq("id", duplicateId).eq("workspace_id", workspace.id);

  await clearSuggestion(supabase, workspace.id, mainId, duplicateId);

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact", entityId: mainId,
    action: "link",
    metadata: {
      merged_from: duplicateId,
      conversations_moved: movableConvs.length,
      conversations_skipped: skipped,
      automatic: false,
    },
    performedBy: user.id,
  });

  revalidateContact(mainId);
  revalidateContact(duplicateId);
  return { ok: true, contactId: mainId };
}

/** Descarta una sugerencia de vinculacion sin unir nada. */
export async function dismissLinkSuggestion(
  contactId: string,
  suggestedContactId: string,
): Promise<ContactActionResult> {
  const { workspace, supabase, user } = await getWorkspace();

  const removed = await clearSuggestion(supabase, workspace.id, contactId, suggestedContactId);
  if (!removed.ok) return removed;

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact", entityId: contactId,
    action: "update", metadata: { dismissed_link_suggestion: suggestedContactId },
    performedBy: user.id,
  });

  revalidateContact(contactId);
  return { ok: true, contactId };
}

// ------------------------------------------------------------------
// Internos
// ------------------------------------------------------------------

/**
 * Update + historial en un solo lugar.
 *
 * Lee el estado anterior para poder diffear: sin eso el historial diria "se
 * edito el contacto" sin decir que cambio, que es justo el dato util.
 */
async function applyPatch({
  supabase, workspaceId, userId, contactId, patch, action,
}: {
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"];
  workspaceId: string;
  userId: string;
  contactId: string;
  patch: ContactPatch | Record<string, unknown>;
  action: "update" | "assign" | "do_not_contact";
}): Promise<ContactActionResult> {
  // Se lee la fila entera y no una lista de columnas: diffFields solo mira las
  // claves del patch, asi que las de mas no molestan y la consulta queda tipada.
  const { data: before } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!before) {
    // O no existe, o el scope de leads no deja verlo. Desde afuera es lo
    // mismo, y decir cual de las dos filtraria informacion.
    return { ok: false, error: "No encontre ese contacto" };
  }

  const { error } = await supabase
    .from("contacts")
    .update(patch)
    .eq("id", contactId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error(`[contacts] ${action} fallido:`, error.message);
    return { ok: false, error: `No pude guardar los cambios: ${error.message}` };
  }

  const changes = diffFields(before as Record<string, unknown>, patch as Record<string, unknown>);
  if (changes) {
    await logAudit({
      supabase, workspaceId, entityType: "contact", entityId: contactId,
      action, changes, performedBy: userId,
    });
  }

  revalidateContact(contactId);
  return { ok: true, contactId };
}

/** Saca una sugerencia de metadata.link_suggestions. */
async function clearSuggestion(
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"],
  workspaceId: string,
  contactId: string,
  suggestedContactId: string,
): Promise<ContactActionResult> {
  const { data: contact } = await supabase
    .from("contacts")
    .select("metadata")
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!contact) return { ok: false, error: "No encontre ese contacto" };

  const metadata = (contact.metadata ?? {}) as Record<string, unknown>;
  const suggestions = Array.isArray(metadata.link_suggestions) ? metadata.link_suggestions : [];
  const remaining = suggestions.filter(
    (s) => (s as { contact_id?: string })?.contact_id !== suggestedContactId,
  );

  const { error } = await supabase
    .from("contacts")
    .update({ metadata: { ...metadata, link_suggestions: remaining } as Json })
    .eq("id", contactId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("[contacts] no pude limpiar la sugerencia:", error.message);
    return { ok: false, error: `No pude descartar la sugerencia: ${error.message}` };
  }

  return { ok: true, contactId };
}
