/**
 * La lista de contactos: secuencias (drip).
 *
 * "En la secuencia…" = una inscripción activa o pausada (una pausa por
 * respuesta sigue siendo estar en la secuencia). Respeta la RLS de
 * `sequence_enrollments`.
 */
import { relatedMultiFilter } from "../filters/catalog";
import { UUID_RE, byContact, fillCells, type CellValue, type ContactListModule, type ListGroupDef } from "../filters/types";

export const SEQUENCES_GROUP: ListGroupDef = { key: "secuencias", label: "Secuencias", order: 95 };

const IN_SEQUENCE = [{ op: "in" as const, column: "status", values: ["active", "paused"] }];

interface EnrollmentRow {
  contact_id: string;
  status: string;
  sequence_id: string;
  enrolled_at: string;
}

export const sequencesModule: ContactListModule = {
  key: "secuencias",
  filters: [
    relatedMultiFilter({
      param: "secuencia",
      label: "En la secuencia",
      group: SEQUENCES_GROUP,
      relation: "sequence_enrollments",
      column: "sequence_id",
      base: IN_SEQUENCE,
      baseColumns: ["status"],
      accepts: (v) => UUID_RE.test(v),
      options: { from: "sequences" },
      keywords: "drip inscripto",
      hint: "Inscripto, activo o en pausa.",
    }),
  ],
  columns: [
    { key: "active_sequence", label: "Secuencia activa", group: SEQUENCES_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "drip" },
  ],
  async loadOptions(supabase, workspaceId) {
    const { data, error } = await supabase.from("sequences").select("id, name").eq("workspace_id", workspaceId).order("name");
    if (error) throw new Error(error.message);
    return { sequences: (data ?? []).map((s) => ({ value: s.id, label: s.name })) };
  },
  async loadCells(supabase, _workspaceId, contactIds, keys) {
    const { data, error } = await supabase
      .from("sequence_enrollments")
      .select("contact_id, status, sequence_id, enrolled_at, sequences(name)")
      .in("contact_id", [...contactIds])
      .in("status", ["active", "paused"])
      .order("enrolled_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Array<EnrollmentRow & { sequences: { name: string } | null }>;
    const grouped = byContact(rows);
    return fillCells(contactIds, keys, (id) => {
      const list = grouped.get(id) ?? [];
      const current = list[0];
      const cells: Record<string, CellValue> = {
        active_sequence: current
          ? { t: "text", text: current.sequences?.name ?? "Secuencia", ...(current.status === "paused" ? { sub: "En pausa" } : list.length > 1 ? { sub: `y ${list.length - 1} más` } : {}) }
          : null,
      };
      return cells;
    });
  },
};
