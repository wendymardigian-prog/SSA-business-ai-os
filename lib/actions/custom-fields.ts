"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import { isCustomFieldType, uniqueSlug } from "@/lib/custom-fields";
import type { CustomFieldType } from "@/lib/types/database";

/**
 * Definiciones de campos personalizados (F6).
 *
 * Hasta ahora no habia forma de crearlas desde la app: existian solo si
 * alguien escribia SQL. Las gestionan Owner y Admin; los valores por contacto
 * los completa cualquiera que vea el contacto, que es otra accion
 * (setContactCustomField).
 *
 * Dos reglas que no son obvias:
 *
 * 1. El slug se genera al crear y NO cambia al renombrar. El flow builder
 *    busca los campos por slug y esos slugs viven adentro del JSON de los
 *    flows, que nada migra: si cambiara, el nodo dejaria de encontrar el campo
 *    y falla sin avisar.
 * 2. Eliminar es logico. Borrar de verdad la definicion se lleva por cascade
 *    el valor que ese campo tenia en CADA contacto, y eso no tiene vuelta.
 */

const SETTINGS_PATH = "/dashboard/settings/custom-fields";
const MAX_NAME = 60;

export type CustomFieldResult = { ok: true; fieldId?: string } | { ok: false; error: string };

export async function createCustomField(
  rawName: string,
  rawType: string,
): Promise<CustomFieldResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden definir campos personalizados" };

  const { workspace, supabase, user } = ctx;

  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "El campo necesita un nombre" };
  if (name.length > MAX_NAME) {
    return { ok: false, error: `El nombre es muy largo (maximo ${MAX_NAME} caracteres)` };
  }
  if (!isCustomFieldType(rawType)) return { ok: false, error: "Ese tipo de campo no existe" };

  // Los slugs de TODAS las definiciones, incluidas las borradas: el indice
  // unico de la tabla no distingue, y reusar el slug de una borrada haria que
  // los flows viejos apunten al campo nuevo.
  const { data: existing } = await supabase
    .from("custom_field_definitions")
    .select("name, slug, deleted_at")
    .eq("workspace_id", workspace.id);

  const yaExiste = (existing ?? []).some(
    (f) => !f.deleted_at && f.name.toLowerCase() === name.toLowerCase(),
  );
  if (yaExiste) return { ok: false, error: `Ya hay un campo que se llama "${name}"` };

  const slug = uniqueSlug(name, (existing ?? []).map((f) => f.slug));

  const { data, error } = await supabase
    .from("custom_field_definitions")
    .insert({ workspace_id: workspace.id, name, slug, type: rawType as CustomFieldType })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[custom-fields] alta fallida:", error?.message);
    return { ok: false, error: `No pude crear el campo: ${error?.message ?? "error desconocido"}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
    action: "create",
    metadata: { section: "custom_field", name, slug, type: rawType },
    performedBy: user.id,
  });

  revalidatePath(SETTINGS_PATH);
  return { ok: true, fieldId: data.id };
}

/**
 * Renombra un campo. El tipo tambien se puede cambiar, pero no cuando ya hay
 * valores cargados: los valores se guardan como texto sin validar, y pasar de
 * texto a numero dejaria datos que el input nuevo blanquea en silencio.
 */
export async function updateCustomField(
  fieldId: string,
  rawName: string,
  rawType: string,
): Promise<CustomFieldResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden editar campos personalizados" };

  const { workspace, supabase, user } = ctx;

  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "El campo necesita un nombre" };
  if (name.length > MAX_NAME) {
    return { ok: false, error: `El nombre es muy largo (maximo ${MAX_NAME} caracteres)` };
  }
  if (!isCustomFieldType(rawType)) return { ok: false, error: "Ese tipo de campo no existe" };

  const { data: before } = await supabase
    .from("custom_field_definitions")
    .select("id, name, type, slug")
    .eq("id", fieldId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontre ese campo" };

  if (before.type !== rawType) {
    const { count } = await supabase
      .from("contact_custom_fields")
      .select("field_id", { count: "exact", head: true })
      .eq("field_id", fieldId);

    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: `No se puede cambiar el tipo: ya hay ${count} contacto(s) con un valor cargado. Creá un campo nuevo.`,
      };
    }
  }

  // El slug NO se toca: los flows lo referencian.
  const { error } = await supabase
    .from("custom_field_definitions")
    .update({ name, type: rawType as CustomFieldType })
    .eq("id", fieldId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[custom-fields] edicion fallida:", error.message);
    return { ok: false, error: `No pude guardar el campo: ${error.message}` };
  }

  const changes = diffFields(
    { name: before.name, type: before.type },
    { name, type: rawType },
  );

  if (changes) {
    await logAudit({
      supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
      action: "update", changes, metadata: { section: "custom_field", slug: before.slug },
      performedBy: user.id,
    });
  }

  revalidatePath(SETTINGS_PATH);
  return { ok: true, fieldId };
}

/**
 * Elimina la definicion. Es logico a proposito: borrarla de verdad se lleva
 * por cascade el valor de ese campo en cada contacto.
 */
export async function deleteCustomField(fieldId: string): Promise<CustomFieldResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden eliminar campos personalizados" };

  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("custom_field_definitions")
    .select("id, name, slug")
    .eq("id", fieldId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontre ese campo" };

  const { error } = await supabase
    .from("custom_field_definitions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", fieldId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[custom-fields] borrado fallido:", error.message);
    return { ok: false, error: `No pude eliminar el campo: ${error.message}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
    action: "delete",
    metadata: { section: "custom_field", name: before.name, slug: before.slug },
    performedBy: user.id,
  });

  revalidatePath(SETTINGS_PATH);
  return { ok: true, fieldId };
}
