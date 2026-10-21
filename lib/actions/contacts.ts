"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import { validateContactInput, type ContactPatch } from "@/lib/contacts/fields";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { parseTrackingParams } from "@/lib/contacts/attribution";
import { recordManualTouch } from "@/lib/contacts/touch-entry";
import { findOrCreateContact } from "@/lib/contacts/find-or-create";
import { describeContactUniqueViolation } from "@/lib/contacts/unique-errors";
import type { Json } from "@/lib/types/database";
import { BULK_TAG_LIMIT } from "@/lib/tags/effects";
import { mergeErrorMessage, mergeNotes, summarizeMerge } from "@/lib/contacts/merge";
import { CUSTOM_VALUE_ERROR_MESSAGES, normalizeCustomValue } from "@/lib/custom-fields";

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
  // Permiso (Equipo y roles, F21): lo repite la RLS cuando corresponde.
  if (!(await getPermissionAction("contacts.edit"))) return { ok: false, error: "No tenés permiso para editar contactos" };

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const validated = validateContactInput(input, timeZone);
  if (!validated.ok) return validated;

  const patch = validated.patch;

  if (!patch.display_name && !patch.email && !patch.phone) {
    return { ok: false, error: "Poné al menos un nombre, un email o un telefono" };
  }

  // Una sola regla para buscar o crear (00200): telefono, WhatsApp, email (y secundario) y los usuarios de
  // Instagram, TikTok, X y LinkedIn, nunca el nombre. Se busca entre TODOS los contactos del workspace,
  // incluso los que quien carga no ve (la funcion corre con el cliente de servicio; el workspace sale de la
  // sesion). Es el unico camino que puede crear un contacto con solo el nombre.
  const service = await createServiceClient();
  const {
    phone, whatsapp_phone, email, secondary_email, instagram_username, tiktok_username, twitter_username,
    linkedin_profile_url, ...rest
  } = patch;

  // Las UTM que traiga el pedido (la pantalla hoy no las pide, la accion si las
  // acepta) se anotan como el toque del alta. Ya no se escribe la forma vieja de
  // clicks en `attribution`: lo escribe `record_contact_touch` (F87).
  const tracking = parseTrackingParams(input);

  let result;
  try {
    result = await findOrCreateContact(service, {
      workspaceId: workspace.id,
      identity: {
        phone, whatsapp_phone, email, secondary_email,
        instagram: instagram_username, tiktok: tiktok_username, x: twitter_username, linkedin: linkedin_profile_url,
      },
      defaults: rest,
      mode: "create",
      allowWithoutIdentity: true,
    });
  } catch (err) {
    console.error("[contacts] alta fallida:", err instanceof Error ? err.message : "error desconocido");
    return { ok: false, error: "No pude crear el contacto. Probá de nuevo en un momento." };
  }

  if (!result.contactId) {
    return { ok: false, error: "No pude crear el contacto" };
  }

  if (!result.created) {
    // Ya existia. Si quien carga lo ve (su RLS), lo llevamos a la ficha; si no, NO le damos ni el enlace ni
    // el nombre: no puede ver ese contacto.
    const { data: visible } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", result.contactId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (visible) {
      const byHandle = result.matchedBy && !["phone", "email"].includes(result.matchedBy);
      return {
        ok: false,
        error: byHandle
          ? "Ya existe un contacto con ese usuario de red social. Te llevo a su ficha."
          : "Ya existe un contacto con ese telefono o email. Te llevo a su ficha.",
        contactId: result.contactId,
        duplicate: true,
      };
    }
    return {
      ok: false,
      error: "Ya existe un contacto con ese dato. Pedile a un Admin que te lo asigne.",
      duplicate: true,
    };
  }

  const data = { id: result.contactId };

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact", entityId: data.id,
    action: "create", metadata: { source: "manual" }, performedBy: user.id,
  });

  // El toque de atribucion lo escribe el servidor: la funcion de la base solo la
  // ejecuta `service_role`. Nunca puede hacer fallar el alta (F87).
  await recordManualTouch(service, {
    workspaceId: workspace.id,
    contactId: data.id,
    tracking,
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
  // Permiso (Equipo y roles, F21): lo repite la RLS cuando corresponde.
  if (!(await getPermissionAction("contacts.edit"))) return { ok: false, error: "No tenés permiso para editar contactos" };

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const validated = validateContactInput(input, timeZone);
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
  // Permiso (Equipo y roles, F21): lo repite la RLS cuando corresponde.
  if (!(await getPermissionAction("contacts.assign"))) return { ok: false, error: "No tenés permiso para reasignar contactos" };

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

  // Lo asignado a mano bloquea lo automatico (Ventas, 00161): desde ahora la
  // asignacion automatica no toca el setter ni el vendedor de este contacto.
  patch.assignment_locked_at = new Date().toISOString();

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
  // Permiso (Equipo y roles, F21): lo repite la RLS cuando corresponde.
  if (!(await getPermissionAction("contacts.edit"))) return { ok: false, error: "No tenés permiso para editar contactos" };

  // Sacar la marca es decision de Owner/Admin: si cualquiera pudiera
  // revertirla, la marca no protegeria de nada.
  if (!value) {
    const admin = await getPermissionAction("contacts.delete");
    if (!admin) {
      return { ok: false, error: "No tenés permiso para sacar la marca de no contactar" };
    }
  }

  const patch = {
    do_not_contact: value,
    do_not_contact_reason: value ? (reason?.trim() || "manual") : null,
    do_not_contact_at: value ? new Date().toISOString() : null,
  };

  const result = await applyPatch({
    supabase, workspaceId: workspace.id, userId: user.id,
    contactId, patch, action: "do_not_contact",
  });

  // Marcar "no contactar" a mano pausa las secuencias activas del contacto,
  // igual que la deteccion automatica (apply_opt_out_check, 00027). Hasta el
  // Bloque 2c solo lo hacia la automatica: la marca manual quedaba con los
  // drips corriendo y el procesador los salteaba de a uno.
  if (result.ok && value) {
    await pauseSequencesForOptOut(workspace.id, contactId, user.id);
  }
  return result;
}

/**
 * Pausa las inscripciones activas del contacto con motivo opt_out (el mismo
 * que usa la deteccion automatica; resumeEnrollment no deja reanudarlas).
 * Service role: sequence_enrollments es de Owner/Admin por RLS y una persona
 * que marca a su lead igual tiene que poder frenarle los drips. El contacto ya
 * paso por la RLS en applyPatch, asi que es de su scope.
 */
async function pauseSequencesForOptOut(workspaceId: string, contactId: string, userId: string): Promise<void> {
  try {
    const service = await createServiceClient();
    const now = new Date().toISOString();
    const { data, error } = await service
      .from("sequence_enrollments")
      .update({ status: "paused", paused_reason: "opt_out", paused_at: now, locked_at: null })
      .eq("contact_id", contactId)
      .eq("status", "active")
      .select("id");
    if (error) {
      console.error("[contacts] no pude pausar las secuencias del contacto:", error.message);
      return;
    }
    const ids = (data ?? []).map((r) => r.id);
    if (ids.length === 0) return;
    await logAudit({
      supabase: service,
      workspaceId,
      entityType: "contact",
      entityId: contactId,
      action: "sequence_paused",
      metadata: { source: "manual", reason: "opt_out", enrollment_ids: ids, count: ids.length, sequences_paused: ids.length },
      performedBy: userId,
    });
  } catch (err) {
    console.error("[contacts] no pude pausar las secuencias del contacto:", err instanceof Error ? err.message : "error desconocido");
  }
}

// ------------------------------------------------------------------
// Borrado logico (F15)
// ------------------------------------------------------------------

/** Marca el contacto como borrado. A los 30 dias lo purga el cron. */
export async function softDeleteContact(contactId: string): Promise<ContactActionResult> {
  const ctx = await getPermissionAction("contacts.delete");
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
  const ctx = await getPermissionAction("contacts.delete");
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
    // Mientras estuvo borrado, otra persona pudo cargar el mismo telefono o email.
    const clear = describeContactUniqueViolation(error);
    if (clear) return { ok: false, error: `No se puede restaurar: ${clear.charAt(0).toLowerCase()}${clear.slice(1)}.` };
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
  // Permiso (Equipo y roles, F21): lo repite la RLS cuando corresponde.
  if (!(await getPermissionAction("contacts.edit"))) return { ok: false, error: "No tenés permiso para editar contactos" };

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
  // Permiso (Equipo y roles, F21): lo repite la RLS cuando corresponde.
  if (!(await getPermissionAction("contacts.edit"))) return { ok: false, error: "No tenés permiso para editar contactos" };

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
 * Pone o saca UNA etiqueta (Bloque 2d-A: las acciones rapidas del panel).
 *
 * No reemplaza el conjunto como setContactTags: un clic sobre "es-conocido"
 * no puede pisar una etiqueta que otra persona puso un segundo antes. Si la
 * etiqueta tiene efecto sobre el agente, lo aplican los triggers de la 00073.
 */
export async function toggleContactTag(
  contactId: string,
  tagId: string,
  on: boolean,
): Promise<ContactActionResult> {
  const { workspace, supabase, user } = await getWorkspace();
  // Permiso (Equipo y roles, F21): lo repite la RLS cuando corresponde.
  if (!(await getPermissionAction("contacts.edit"))) return { ok: false, error: "No tenés permiso para editar contactos" };
  if (typeof contactId !== "string" || typeof tagId !== "string" || typeof on !== "boolean") {
    return { ok: false, error: "Pedido invalido" };
  }

  const [{ data: tag }, { data: contact }] = await Promise.all([
    supabase.from("tags").select("id, name").eq("id", tagId).eq("workspace_id", workspace.id).maybeSingle(),
    // Pasa por la RLS: un lead fuera del scope no vuelve.
    supabase.from("contacts").select("id").eq("id", contactId).eq("workspace_id", workspace.id).maybeSingle(),
  ]);
  if (!tag) return { ok: false, error: "No encontre esa etiqueta" };
  if (!contact) return { ok: false, error: "No encontre ese contacto" };

  const { error } = on
    ? await supabase
        .from("contact_tags")
        .upsert({ contact_id: contactId, tag_id: tagId }, { onConflict: "contact_id,tag_id", ignoreDuplicates: true })
    : await supabase.from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", tagId);
  if (error) {
    console.error("[contacts] no pude cambiar la etiqueta:", error.message);
    return { ok: false, error: on ? "No pude poner la etiqueta. Probá de nuevo." : "No pude sacar la etiqueta. Probá de nuevo." };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact", entityId: contactId,
    action: "update",
    metadata: { tag: tag.name, tag_id: tag.id, [on ? "added" : "removed"]: true, origin: "quick_action" },
    performedBy: user.id,
  });

  revalidateContact(contactId);
  revalidatePath("/dashboard/inbox");
  return { ok: true, contactId };
}

export type BulkTagResult =
  | { ok: true; tagged: number; alreadyHad: number; notAllowed: number }
  | { ok: false; error: string };

/**
 * Etiqueta varios contactos de una vez (Bloque 2d-A). Ana va a marcar varias
 * decenas de conocidos de una sentada; de a uno es la diferencia entre que lo
 * haga y que no.
 *
 * Con el cliente del usuario: la RLS de contact_tags (EXISTS sobre contacts)
 * decide que contactos puede tocar, asi un Member solo etiqueta sus leads.
 * Los que ya tenian la etiqueta no se tocan (ON CONFLICT DO NOTHING): no
 * disparan el efecto de nuevo, asi una conversacion que alguien prendio a
 * mano no se vuelve a apagar.
 */
export async function bulkAddTag(contactIds: string[], tagId: string): Promise<BulkTagResult> {
  const { workspace, supabase, user } = await getWorkspace();
  // Permiso (Equipo y roles, F21): lo repite la RLS cuando corresponde.
  if (!(await getPermissionAction("contacts.edit"))) return { ok: false, error: "No tenés permiso para editar contactos" };

  if (!Array.isArray(contactIds) || typeof tagId !== "string") return { ok: false, error: "Pedido invalido" };
  const ids = [...new Set(contactIds.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))];
  if (ids.length === 0) return { ok: false, error: "No hay contactos seleccionados" };
  if (ids.length > BULK_TAG_LIMIT) {
    return { ok: false, error: `Son demasiados: hasta ${BULK_TAG_LIMIT} contactos por vez.` };
  }

  const { data: tag } = await supabase.from("tags").select("id, name").eq("id", tagId).eq("workspace_id", workspace.id).maybeSingle();
  if (!tag) return { ok: false, error: "No encontre esa etiqueta" };

  // Los que puede ver (RLS) y los que ya la tenian.
  const [{ data: visible }, { data: had }] = await Promise.all([
    supabase.from("contacts").select("id").eq("workspace_id", workspace.id).in("id", ids),
    supabase.from("contact_tags").select("contact_id").eq("tag_id", tagId).in("contact_id", ids),
  ]);
  const allowed = new Set((visible ?? []).map((c) => c.id));
  const already = new Set((had ?? []).map((r) => r.contact_id));
  const toTag = ids.filter((id) => allowed.has(id) && !already.has(id));

  if (toTag.length > 0) {
    const { data: inserted, error } = await supabase
      .from("contact_tags")
      .upsert(toTag.map((contact_id) => ({ contact_id, tag_id: tagId })), { onConflict: "contact_id,tag_id", ignoreDuplicates: true })
      .select("contact_id");
    if (error) {
      console.error("[contacts] fallo el etiquetado masivo:", error.message);
      return { ok: false, error: "No pude etiquetar los contactos. Probá de nuevo." };
    }
    const done = (inserted ?? []).map((r) => r.contact_id);
    for (const contactId of done) {
      await logAudit({
        supabase, workspaceId: workspace.id, entityType: "contact", entityId: contactId,
        action: "update",
        metadata: { tag: tag.name, tag_id: tag.id, added: true, origin: "bulk", batch_size: toTag.length },
        performedBy: user.id,
      });
    }
    revalidatePath(LIST_PATH);
    revalidatePath("/dashboard/inbox");
    return { ok: true, tagged: done.length, alreadyHad: ids.filter((id) => already.has(id)).length, notAllowed: ids.length - allowed.size };
  }

  return { ok: true, tagged: 0, alreadyHad: ids.filter((id) => already.has(id)).length, notAllowed: ids.length - allowed.size };
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
  // Permiso (Equipo y roles, F21): lo repite la RLS cuando corresponde.
  if (!(await getPermissionAction("contacts.edit"))) return { ok: false, error: "No tenés permiso para editar contactos" };

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
  // Permiso (Equipo y roles, F21): lo repite la RLS cuando corresponde.
  if (!(await getPermissionAction("contacts.edit"))) return { ok: false, error: "No tenés permiso para editar contactos" };

  const { data: field } = await supabase
    .from("custom_field_definitions")
    .select("id, name, type")
    .eq("id", fieldId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!field) return { ok: false, error: "Ese campo personalizado no existe en este workspace" };

  // El tipo manda: la misma regla que la importación, los flujos y el webhook.
  let clean = value.trim();
  if (clean) {
    const normalized = normalizeCustomValue(field.type, clean);
    if (!normalized.ok) return { ok: false, error: `"${field.name}" ${CUSTOM_VALUE_ERROR_MESSAGES[normalized.reason]}` };
    clean = normalized.value;
  }

  // El valor anterior, para que el historial diga "antes → después".
  const { data: previous } = await supabase
    .from("contact_custom_fields")
    .select("value")
    .eq("contact_id", contactId)
    .eq("field_id", fieldId)
    .maybeSingle();
  const oldValue = previous?.value ?? null;
  if ((oldValue ?? "") === clean) return { ok: true, contactId };

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
    action: "update", changes: { [`custom:${field.name}`]: { old: oldValue, new: clean || null } },
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
 * Todo lo que colgaba del duplicado pasa al principal: conversaciones y sus mensajes, canales, etiquetas, notas,
 * agendas, llamadas, ventas (con sus pagos), tareas, formularios, secuencias, toques de atribucion y el resto (la lista
 * completa es `CONTACT_MERGE_TABLES`). Lo hace `merge_contacts` en la base, en UNA transaccion: si algo falla, no se
 * mueve nada. Los campos de identidad vacios del principal se completan con los del duplicado (nunca al reves), las
 * notas se juntan y el duplicado queda con borrado logico (reversible durante 30 dias) y `metadata.merged_into`.
 *
 * Es Owner/Admin porque implica borrar (logicamente) un contacto. La funcion de la base solo la ejecuta el servidor:
 * por eso se llama con el cliente de servicio, DESPUES de comprobar permiso y que los dos contactos se ven.
 */
export async function linkContacts(
  duplicateId: string,
  mainId: string,
): Promise<ContactActionResult & { summary?: string; notes?: string[]; moved?: Record<string, number> }> {
  const ctx = await getPermissionAction("contacts.merge");
  if (!ctx) return { ok: false, error: "No tenés permiso para fusionar contactos" };
  if (duplicateId === mainId) return { ok: false, error: "Es el mismo contacto" };

  const { workspace, supabase, user } = ctx;

  const { data: pair } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspace.id)
    .in("id", [duplicateId, mainId])
    .is("deleted_at", null);

  const main = pair?.find((c) => c.id === mainId);
  const duplicate = pair?.find((c) => c.id === duplicateId);
  if (!main || !duplicate) return { ok: false, error: "No encontre alguno de los dos contactos" };

  try {
    const service = await createServiceClient();
    const { data, error } = await service.rpc("merge_contacts", {
      p_workspace_id: workspace.id,
      p_main: mainId,
      p_duplicate: duplicateId,
      p_actor: user.id,
    });
    if (error) {
      console.error("[contacts] merge_contacts:", error.message);
      return { ok: false, error: mergeErrorMessage(error.message) };
    }
    const result = (data ?? {}) as { ok?: boolean; moved?: Record<string, number> };
    if (!result.ok) return { ok: false, error: mergeErrorMessage(undefined) };

    revalidateContact(mainId);
    revalidateContact(duplicateId);
    // Lo que se movio aparece de inmediato en las pantallas que lo muestran.
    revalidatePath("/dashboard/tareas");
    revalidatePath("/dashboard/agenda");
    revalidatePath("/dashboard/ventas");
    return { ok: true, contactId: mainId, summary: summarizeMerge(result), notes: mergeNotes(result), moved: result.moved ?? {} };
  } catch (error) {
    console.error("[contacts] linkContacts:", error instanceof Error ? error.message : String(error));
    return { ok: false, error: mergeErrorMessage(undefined) };
  }
}

/** Descarta una sugerencia de vinculacion sin unir nada. */
export async function dismissLinkSuggestion(
  contactId: string,
  suggestedContactId: string,
): Promise<ContactActionResult> {
  const { workspace, supabase, user } = await getWorkspace();
  // Permiso (Equipo y roles, F21): lo repite la RLS cuando corresponde.
  if (!(await getPermissionAction("contacts.edit"))) return { ok: false, error: "No tenés permiso para editar contactos" };

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
    const clear = describeContactUniqueViolation(error);
    if (clear) return { ok: false, error: clear };
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
