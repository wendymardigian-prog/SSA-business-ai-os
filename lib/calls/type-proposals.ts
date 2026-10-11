/**
 * Los tipos de llamada que propone la IA (F17/F19): una lectura agrupada de
 * `calls.call_type_proposed`. Aceptar uno lo vuelve un tipo propio; descartarlo
 * lo manda a `discarded_types`. No hay tabla de propuestas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { slugKey } from "./rubric";
import { newCustomType, validTypeKeys, type CallClassificationSettings } from "./task-settings";

type Db = SupabaseClient<Database>;

export interface TypeProposal {
  key: string;
  /** Como lo escribio la IA (el mas usado). */
  name: string;
  calls: number;
}

export function groupTypeProposals(rows: Array<{ call_type_proposed: string | null }>, settings: CallClassificationSettings): TypeProposal[] {
  const valid = new Set(validTypeKeys(settings.custom_types));
  const discarded = new Set(settings.discarded_types.map((d) => slugKey(d)));
  const found = new Map<string, { name: string; calls: number; names: Map<string, number> }>();
  for (const row of rows) {
    const name = row.call_type_proposed?.trim();
    if (!name) continue;
    const key = slugKey(name);
    if (!key || valid.has(key) || discarded.has(key)) continue;
    const entry = found.get(key) ?? { name, calls: 0, names: new Map() };
    entry.calls += 1;
    entry.names.set(name, (entry.names.get(name) ?? 0) + 1);
    found.set(key, entry);
  }
  return [...found.entries()]
    .map(([key, e]) => ({ key, name: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0], calls: e.calls }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name, "es"));
}

/** Lectura con el cliente de servicio (despues de comprobar `calls.configure`). Solo trae la columna del tipo propuesto. */
export async function loadTypeProposals(service: Db, workspaceId: string, settings: CallClassificationSettings): Promise<TypeProposal[]> {
  const { data, error } = await service
    .from("calls")
    .select("call_type_proposed")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .not("call_type_proposed", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(2000);
  if (error || !data) {
    if (error) console.error("[llamadas] no pude leer los tipos propuestos:", error.message);
    return [];
  }
  return groupTypeProposals(data, settings);
}

/** Aceptar: el tipo pasa a ser propio. */
export function acceptTypeProposal(settings: CallClassificationSettings, name: string, description = ""): CallClassificationSettings {
  const next = structuredClone(settings);
  next.custom_types.push(newCustomType(name, description, settings.custom_types));
  next.discarded_types = next.discarded_types.filter((d) => slugKey(d) !== slugKey(name));
  return next;
}

/** Descartar: no se vuelve a proponer. */
export function discardTypeProposal(settings: CallClassificationSettings, name: string): CallClassificationSettings {
  const next = structuredClone(settings);
  if (!next.discarded_types.some((d) => slugKey(d) === slugKey(name))) next.discarded_types.push(name.trim());
  return next;
}
