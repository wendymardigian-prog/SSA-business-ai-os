/**
 * La lista de contactos: llamadas grabadas (Fathom).
 *
 * Respeta la RLS de `calls` (`can_see_call`).
 *
 * Es del módulo Llamadas: la plantilla de estudiantes no lo lleva y borra este
 * archivo (`scripts/plantilla/perfiles/estudiantes.mjs`).
 */
import { hasRelatedFilter } from "../filters/catalog";
import { byContact, fillCells, type CellValue, type ContactListModule, type ListGroupDef } from "../filters/types";

export const CALLS_GROUP: ListGroupDef = { key: "llamadas", label: "Llamadas", order: 92 };

interface CallRow {
  contact_id: string;
  recorded_at: string;
  outcome: string | null;
  title: string;
}

export const callsModule: ContactListModule = {
  key: "llamadas",
  filters: [hasRelatedFilter({ param: "llamada", label: "Tiene llamada", group: CALLS_GROUP, relation: "calls", columns: ["id"], keywords: "fathom grabada" })],
  columns: [{ key: "last_call", label: "Última llamada", group: CALLS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "fathom resultado" }],
  async loadCells(supabase, workspaceId, contactIds, keys) {
    const { data, error } = await supabase
      .from("calls")
      .select("contact_id, recorded_at, outcome, title")
      .eq("workspace_id", workspaceId)
      .in("contact_id", [...contactIds])
      .order("recorded_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const grouped = byContact((data ?? []) as CallRow[]);
    return fillCells(contactIds, keys, (id) => {
      const last = grouped.get(id)?.[0];
      const cells: Record<string, CellValue> = {
        last_call: last ? { t: "date", at: last.recorded_at, mode: "day", sub: last.outcome ?? last.title } : null,
      };
      return cells;
    });
  },
};
