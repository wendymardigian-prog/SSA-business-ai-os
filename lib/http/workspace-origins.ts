/**
 * Los orígenes permitidos del workspace dueño de un recurso público (el workspace de un
 * formulario sale de `lib/forms/site-origins.ts`). SOLO servidor,
 * siempre con el cliente de SERVICIO (lo llaman rutas sin sesión).
 *
 * Ante cualquier error (la base no contesta, falta la columna de la 00277) devuelve la
 * lista VACÍA: ningún origen externo pasa, y los formularios de la propia app siguen
 * andando (son del mismo origen). Nunca se abre de más por un error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseWebsiteSettings, type WebsiteSettings } from "@/lib/settings/website";

// Sin el tipo de la base a propósito: `website_settings` es nueva (00277) y esto tiene que
// degradar sin romper si la columna todavía no está.
type Service = SupabaseClient;

const EMPTY: WebsiteSettings = { allowedOrigins: [] };

/** Los orígenes de un workspace por su id. */
export async function originsForWorkspace(service: Service, workspaceId: string): Promise<WebsiteSettings> {
  try {
    const { data, error } = await service.from("workspaces").select("website_settings").eq("id", workspaceId).maybeSingle();
    if (error || !data) return EMPTY;
    return parseWebsiteSettings((data as { website_settings?: unknown }).website_settings);
  } catch {
    return EMPTY;
  }
}

/** Lo que identifica a un workspace en un pedido público: su slug (`workspaces.slug`). */
// Laxo a propósito: el trigger de alta arma el slug con el nombre del negocio (puede empezar
// con un guion si el nombre empieza con un signo).
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9-]{3,100}$/;

/** El workspace por su slug, con sus orígenes, o null si no existe. */
export async function workspaceBySlug(service: Service, slug: string): Promise<{ id: string; settings: WebsiteSettings } | null> {
  const wanted = (slug ?? "").trim().toLowerCase();
  if (!WORKSPACE_SLUG_PATTERN.test(wanted)) return null;
  try {
    const { data, error } = await service.from("workspaces").select("id, website_settings").eq("slug", wanted).maybeSingle();
    if (error || !data) return null;
    const row = data as { id: string; website_settings?: unknown };
    return { id: row.id, settings: parseWebsiteSettings(row.website_settings) };
  } catch {
    return null;
  }
}
