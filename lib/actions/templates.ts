"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import { usedVariables } from "@/lib/templates/interpolate";

/**
 * Templates de respuesta rapida (F17).
 *
 * Permisos: los ve y los usa cualquier miembro (el selector "/" de la bandeja
 * los necesita), los gestionan Owner y Admin. La regla vive en la RLS
 * (migracion 00023) y se repite aca para poder devolver un mensaje claro en
 * vez de un silencioso "0 filas afectadas".
 *
 * Sobre el atajo: se normaliza a minusculas y con barra adelante antes de
 * guardarlo, porque en la bandeja se escribe atras de "/" y tiene que ser
 * tipeable. La unicidad por workspace la garantiza el indice de la migracion
 * 00026; aca se traduce ese error de base a una frase entendible.
 *
 * Borrar es logico (F15): el template desaparece de las listas y a los 30 dias
 * lo purga el cron.
 */

const MAX_NAME = 80;
const MAX_CONTENT = 5000;
const MAX_SHORTCUT = 30;

const SHORTCUT_FORMAT = /^\/[a-z0-9][a-z0-9_-]{0,29}$/;

const LIST_PATH = "/dashboard/settings/templates";

export type TemplateActionResult =
  | { ok: true; templateId?: string }
  | { ok: false; error: string };

export interface TemplateInput {
  name: string;
  content: string;
  shortcut?: string | null;
}

interface ValidTemplate extends Record<string, unknown> {
  name: string;
  content: string;
  shortcut: string | null;
}

/**
 * Deja el atajo como se guarda: minusculas, sin espacios y con una sola barra
 * adelante. Devuelve null cuando el campo vino vacio, que es valido.
 */
function normalizeShortcut(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function validate(input: TemplateInput): { ok: true; value: ValidTemplate } | { ok: false; error: string } {
  const name = (input.name ?? "").trim();
  const content = (input.content ?? "").trim();

  if (!name) return { ok: false, error: "Poné un nombre para el template" };
  if (name.length > MAX_NAME) {
    return { ok: false, error: `El nombre es muy largo (maximo ${MAX_NAME} caracteres)` };
  }

  if (!content) return { ok: false, error: "El template no puede estar vacio" };
  if (content.length > MAX_CONTENT) {
    return { ok: false, error: `El texto es muy largo (maximo ${MAX_CONTENT} caracteres)` };
  }

  const shortcut = normalizeShortcut(input.shortcut);
  if (shortcut) {
    if (shortcut.length > MAX_SHORTCUT + 1) {
      return { ok: false, error: `El atajo es muy largo (maximo ${MAX_SHORTCUT} caracteres)` };
    }
    if (!SHORTCUT_FORMAT.test(shortcut)) {
      return {
        ok: false,
        error: "El atajo solo puede tener letras, numeros, guiones y guiones bajos. Por ejemplo: /precio",
      };
    }
  }

  // Una variable inventada no rompe nada (se deja tal cual en el texto), pero
  // casi siempre es un error de tipeo que recien se descubre con el lead
  // leyendo el mensaje.
  const { unknown } = usedVariables(content);
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Esta variable no existe: {{${unknown[0]}}}. Usá el listado de variables disponibles.`,
    };
  }

  return { ok: true, value: { name, content, shortcut } };
}

/** El error del indice unico de la 00026 dicho en castellano. */
function describeError(message: string | undefined): string {
  if (message?.includes("idx_response_templates_shortcut")) {
    return "Ya hay otro template con ese atajo. Elegí uno distinto.";
  }
  return message ?? "error desconocido";
}

export async function createTemplate(input: TemplateInput): Promise<TemplateActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden crear templates" };

  const { workspace, supabase, user } = ctx;

  const validated = validate(input);
  if (!validated.ok) return validated;

  const { data, error } = await supabase
    .from("response_templates")
    .insert({ workspace_id: workspace.id, ...validated.value, created_by: user.id })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[templates] alta fallida:", error?.message);
    return { ok: false, error: `No pude crear el template: ${describeError(error?.message)}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "response_template", entityId: data.id,
    action: "create", metadata: { name: validated.value.name }, performedBy: user.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, templateId: data.id };
}

export async function updateTemplate(
  templateId: string,
  input: TemplateInput,
): Promise<TemplateActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden editar templates" };

  const { workspace, supabase, user } = ctx;

  const validated = validate(input);
  if (!validated.ok) return validated;

  const { data: before } = await supabase
    .from("response_templates")
    .select("id, name, content, shortcut")
    .eq("id", templateId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontre ese template" };

  const { error } = await supabase
    .from("response_templates")
    .update(validated.value)
    .eq("id", templateId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[templates] edicion fallida:", error.message);
    return { ok: false, error: `No pude guardar el template: ${describeError(error.message)}` };
  }

  const changes = diffFields(before, validated.value);
  if (changes) {
    await logAudit({
      supabase, workspaceId: workspace.id, entityType: "response_template", entityId: templateId,
      action: "update", changes, performedBy: user.id,
    });
  }

  revalidatePath(LIST_PATH);
  return { ok: true, templateId };
}

/** Borrado logico (F15): el template deja de aparecer y a los 30 dias se purga. */
export async function deleteTemplate(templateId: string): Promise<TemplateActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden eliminar templates" };

  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("response_templates")
    .select("id, name")
    .eq("id", templateId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontre ese template" };

  const { error } = await supabase
    .from("response_templates")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", templateId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[templates] borrado fallido:", error.message);
    return { ok: false, error: `No pude eliminar el template: ${error.message}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "response_template", entityId: templateId,
    action: "delete", metadata: { name: before.name }, performedBy: user.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, templateId };
}

/**
 * Los templates que puede usar quien esta mirando la bandeja. Se expone como
 * action ademas de cargarse en la pagina para que el selector pueda refrescar
 * sin recargar toda la vista.
 */
export async function listTemplates() {
  const { workspace, supabase } = await getWorkspace();

  const { data, error } = await supabase
    .from("response_templates")
    .select("id, name, content, shortcut")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("name");

  if (error) {
    console.error("[templates] listado fallido:", error.message);
    return [];
  }

  return data ?? [];
}
