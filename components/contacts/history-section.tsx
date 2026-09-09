import { CONTACT_FIELDS } from "@/lib/contacts/fields";
import type { AuditAction, Json } from "@/lib/types/database";
import { EmptyHint, Section, formatDateTime } from "./ui";

/**
 * Historial de cambios del contacto: las ultimas entradas del audit_log.
 *
 * Ojo con lo que se ve aca: la RLS de audit_log deja que un Member lea solo
 * sus propias acciones. O sea, un Member ve su historial y un Owner/Admin ve
 * el de todos. No es un bug de la pantalla.
 */

export interface HistoryEntry {
  id: string;
  action: AuditAction;
  changes: Json | null;
  metadata: Json | null;
  performedAt: string;
  actorLabel: string;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "creó el contacto",
  update: "editó el contacto",
  delete: "eliminó el contacto",
  restore: "restauró el contacto",
  assign: "cambió la asignación",
  link: "vinculó el contacto",
  import: "importó el contacto",
  do_not_contact: "cambió la marca de no contactar",
  automation_triggered: "disparó una automatización",
  enroll: "lo inscribió en una secuencia",
  collision_detected: "quedó en más de una secuencia por el mismo canal",
  collision_resolved: "resolvió la colisión de secuencias",
  sequence_paused: "pausó las secuencias del contacto",
  sequence_resumed: "reanudó una secuencia del contacto",
};

const FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(CONTACT_FIELDS.map((f) => [f.key, f.label])),
  setter_id: "Setter",
  vendedor_id: "Vendedor",
  do_not_contact: "No contactar",
  do_not_contact_reason: "Motivo de no contactar",
  tags: "Tags",
};

export function HistorySection({ entries }: { entries: HistoryEntry[] }) {
  return (
    <Section title="Historial de cambios">
      {entries.length === 0 ? (
        <EmptyHint>Todavía no hay cambios registrados en este contacto.</EmptyHint>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-border p-3">
              <p className="text-sm">
                <span className="font-medium">{entry.actorLabel}</span>{" "}
                {ACTION_LABELS[entry.action] ?? entry.action}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDateTime(entry.performedAt)}
              </p>
              {renderChanges(entry.changes)}
              {renderLinkNote(entry)}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function renderChanges(changes: Json | null) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null;

  const entries = Object.entries(changes as Record<string, unknown>);
  if (entries.length === 0) return null;

  return (
    <ul className="mt-2 space-y-0.5">
      {entries.map(([field, delta]) => {
        const change = delta as { old?: unknown; new?: unknown } | null;
        return (
          <li key={field} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {FIELD_LABELS[field] ?? field.replace(/^custom:/, "")}
            </span>
            : {display(change?.old)} → {display(change?.new)}
          </li>
        );
      })}
    </ul>
  );
}

/** Las vinculaciones automaticas no tienen "changes": el dato util es el motivo. */
function renderLinkNote({ action, metadata }: HistoryEntry) {
  if (action !== "link" || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const meta = metadata as Record<string, unknown>;
  const reason = typeof meta.linked_by === "string" ? meta.linked_by : null;
  const automatic = meta.automatic === true;

  const REASONS: Record<string, string> = {
    phone: "coincidió el teléfono",
    email: "coincidió el email",
    username: "coincidió el usuario de la red",
    channel: "ya conocíamos a este remitente",
  };

  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {automatic ? "Automático" : "Manual"}
      {reason && ` · ${REASONS[reason] ?? reason}`}
    </p>
  );
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "vacío";
  if (typeof value === "boolean") return value ? "sí" : "no";
  return String(value);
}
