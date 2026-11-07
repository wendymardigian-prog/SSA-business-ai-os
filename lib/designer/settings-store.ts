/**
 * Leer y cambiar `workspaces.design_settings` (F11 y F37): estilos propios,
 * fuentes de Google, fuentes subidas y paleta.
 *
 * Se escribe SOLO con el cliente de servicio, DESPUÉS de chequear `designer.manage`,
 * filtrando por el negocio de la sesión. Cada cambio es leer → cambiar → validar
 * con `parseDesignSettings(json, workspaceId)` (la gemela TypeScript del trigger
 * `validate_design_settings`) → guardar SOLO si nadie guardó en el medio
 * (compara `updated_at`; si cambió, vuelve a leer, hasta 3 veces). Así dos
 * personas que agregan una fuente a la vez no se pisan.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { parseDesignSettings, type DesignSettings } from "./settings-schema";

type Db = SupabaseClient<Database>;

/** Los ajustes ya validados y completos (sin `undefined`). */
export type LoadedSettings = Required<Pick<DesignSettings, "palette" | "styles">> & DesignSettings & { fonts: { google: string[]; uploaded: NonNullable<NonNullable<DesignSettings["fonts"]>["uploaded"]> } };

export type MutateResult = { ok: true; next: DesignSettings } | { ok: false; error: string };

export type UpdateSettingsResult = { ok: true; settings: LoadedSettings } | { ok: false; error: string };

const MAX_ATTEMPTS = 3;

function completed(settings: ReturnType<typeof parseDesignSettings> & { ok: true }): LoadedSettings {
  const s = settings.settings;
  return { ...s, palette: s.palette, styles: s.styles, fonts: { google: s.fonts?.google ?? [], uploaded: s.fonts?.uploaded ?? [] } };
}

export async function readDesignSettings(db: Db, workspaceId: string): Promise<{ settings: LoadedSettings; updatedAt: string | null } | null> {
  const { data, error } = await db.from("workspaces").select("design_settings, updated_at").eq("id", workspaceId).maybeSingle();
  if (error || !data) {
    if (error) console.error("[designer-settings] no pude leer los ajustes:", error.message);
    return null;
  }
  const parsed = parseDesignSettings(data.design_settings, workspaceId);
  // Un ajuste guardado que ya no valida se trata como vacío para la pantalla; guardar uno nuevo lo reemplaza entero.
  const settings: LoadedSettings = parsed.ok ? completed(parsed) : { v: 1, palette: [], styles: [], fonts: { google: [], uploaded: [] } };
  return { settings, updatedAt: (data as { updated_at?: string }).updated_at ?? null };
}

/** Cambia los ajustes con control de concurrencia. `mutate` recibe lo vigente y devuelve lo nuevo (o un error en español). */
export async function updateDesignSettings(db: Db, workspaceId: string, mutate: (current: LoadedSettings) => MutateResult | Promise<MutateResult>): Promise<UpdateSettingsResult> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await readDesignSettings(db, workspaceId);
    if (!current) return { ok: false, error: "No pude leer los ajustes del negocio. Probá de nuevo." };
    const changed = await mutate(current.settings);
    if (!changed.ok) return changed;
    const validated = parseDesignSettings({ v: 1, ...changed.next }, workspaceId);
    if (!validated.ok) return { ok: false, error: validated.problems[0] ?? "Los ajustes no son válidos." };

    let query = db.from("workspaces").update({ design_settings: validated.settings as unknown as Json }).eq("id", workspaceId);
    if (current.updatedAt) query = query.eq("updated_at", current.updatedAt);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) {
      console.error("[designer-settings] no pude guardar los ajustes:", error.message);
      return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };
    }
    if (data) return { ok: true, settings: completed(validated) };
    // Otra persona guardó en el medio: se vuelve a leer y a aplicar el cambio.
  }
  return { ok: false, error: "Hubo cambios al mismo tiempo y no pude guardar. Probá de nuevo." };
}
