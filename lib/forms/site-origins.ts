/**
 * El workspace dueño de un formulario publicado, para el CORS de sus rutas públicas
 * (`app/api/public/forms/[slug]/*`). SOLO servidor, con el cliente de SERVICIO.
 * Ante cualquier error, null: sin workspace no pasa ningún origen externo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SLUG_PATTERN } from "./list";

/** El workspace de un formulario PUBLICADO (por su slug), o null. */
export async function workspaceOfPublishedForm(service: SupabaseClient, slug: string): Promise<string | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  try {
    const { data, error } = await service
      .from("forms")
      .select("workspace_id")
      .ilike("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    if (error || !data) return null;
    return (data as { workspace_id: string }).workspace_id;
  } catch {
    return null;
  }
}

