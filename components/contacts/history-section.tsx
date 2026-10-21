"use client";

import { useState } from "react";
import { CONTACT_FIELDS } from "@/lib/contacts/fields";
import { describeHistoryItem, type AuditHistoryItem, type HistoryItem } from "@/lib/contacts/history";
import type { AuditAction, Json } from "@/lib/types/database";
import { CALL_ACTION_LABELS, COMMISSION_ACTION_LABELS, FINANCE_ACTION_LABELS, FORM_ACTION_LABELS, SALE_ACTION_LABELS } from "@/lib/audit-history";
import { EmptyHint, Section, formatDateTime } from "./ui";

/**
 * Historial del contacto: todo lo que le paso, en un solo orden.
 *
 * Junta lo que el sistema anota del contacto (el `audit_log`) con lo
 * AUTOMATICO: las automatizaciones que corrieron (con su nombre), las
 * secuencias en las que lo inscribieron y los emails automaticos que le
 * salieron. Los mensajes de chat no van: ya estan en Conversaciones. Como se
 * arma, en `lib/contacts/history.ts`.
 *
 * Ojo con lo del audit: la RLS de audit_log deja que un Member lea solo sus
 * propias acciones. O sea, un Member ve su historial y un Owner/Admin ve el de
 * todos. No es un bug de la pantalla.
 */

/** Cuantas entradas se ven de entrada; el resto, con "Ver más". */
const INITIAL_VISIBLE = 15;

type HistoryEntry = AuditHistoryItem;

const ACTION_LABELS: Record<AuditAction, string> = {
  // El historial de un anuncio (entity meta_ad) no se muestra en la ficha del contacto; las etiquetas existen por el tipo.
  // Extra I (MP): los métodos de pago del negocio se auditan sobre el workspace; no se ven en la ficha de un contacto.
  "payment_methods.updated": "cambió los métodos de pago",
  "content_link.linked": "vinculó el anuncio con una pieza de contenido",
  "content_link.unlinked": "desvinculó el anuncio de su pieza de contenido",
  // Pipeline (00245): el cambio de estado se ve con su propia entrada (contact_status_changes);
  // la del agente queda en el audit para poder revertirla.
  setter_status: "cambió el estado de setter",
  "contact_statuses.updated": "cambió las listas de estados",
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
  human_takeover: "derivó la conversación a una persona",
  agent_toggled: "cambió el agente de IA en la conversación",
  agent_paused: "pausó el agente de IA",
  agent_resumed: "reanudó el agente de IA",
  prompt_version: "cambió el prompt del agente",
  model_changed: "cambió el modelo de una tarea de IA",
  tag: "etiquetó el contacto",
  temperature: "cambió la temperatura del lead",
  followup: "programó el próximo seguimiento",
  summary: "guardó el resumen del agente",
  revert: "revirtió una acción del agente",
  whatsapp_handoff: "pasó el lead a WhatsApp",
  tag_effect: "aplicó el efecto de una etiqueta",
  // Mejoras de Chat: el asistente no pudo entender un mensaje (F10, F11).
  needs_human: "derivó la conversación porque no pudo entender un mensaje",
  needs_human_resolved: "marcó la conversación como vista",
  // Agenda (Etapa 4). Las de agenda con entity_type = 'booking' se muestran
  // en el detalle de la agenda; aca quedan por si alguna cae en el contacto.
  "scheduling_profile.created": "creó su perfil de agenda",
  "scheduling_profile.updated": "editó su perfil de agenda",
  "google_calendar.connected": "conectó una cuenta de Google Calendar",
  "google_calendar.disconnected": "desconectó una cuenta de Google Calendar",
  "schedule.created": "creó un horario",
  "schedule.updated": "editó un horario",
  "schedule.deleted": "borró un horario",
  "out_of_office.created": "cargó un tiempo fuera",
  "out_of_office.updated": "editó un tiempo fuera",
  "out_of_office.deleted": "borró un tiempo fuera",
  "category.created": "creó una categoría de agenda",
  "category.updated": "editó una categoría de agenda",
  "category.archived": "archivó una categoría de agenda",
  "event_type.created": "creó un evento de agenda",
  "event_type.updated": "editó un evento de agenda",
  "event_type.deleted": "borró un evento de agenda",
  "booking.created": "agendó una llamada",
  "booking.rescheduled": "reagendó una llamada",
  "booking.cancelled": "canceló una llamada",
  "booking.updated": "editó una agenda",
  "booking.status_changed": "cambió el estado de una agenda",
  "booking.sync_ok": "sincronizó la agenda con Google",
  "booking.sync_failed": "no pudo sincronizar la agenda con Google",
  "booking.slot_released": "liberó el espacio de una agenda",
  "booking.slot_occupied": "volvió a ocupar el espacio de una agenda",
  "booking.host_changed": "reasignó el anfitrión de una agenda",
  agent_asset_sent: "mandó un recurso de audio de la banca",
  // Webhooks entrantes: son del endpoint, no del contacto; quedan por si alguna cae en la ficha.
  "webhook_endpoint.created": "creó un endpoint de webhooks",
  "webhook_endpoint.updated": "editó un endpoint de webhooks",
  "webhook_endpoint.paused": "pausó un endpoint de webhooks",
  "webhook_endpoint.resumed": "reanudó un endpoint de webhooks",
  "webhook_endpoint.token_regenerated": "regeneró la URL de un endpoint de webhooks",
  "webhook_endpoint.secret_changed": "cambió el secreto de un endpoint de webhooks",
  "webhook_endpoint.sample_saved": "guardó un ejemplo de un endpoint de webhooks",
  "webhook_endpoint.deleted": "borró un endpoint de webhooks",
  "webhook_endpoint.reprocessed": "reprocesó un envío de webhooks",
  "task.created": "creó una tarea",
  "task.updated": "editó una tarea",
  "task.reopened": "reabrió una tarea",
  "task.completed": "completó una tarea",
  "task.date_shifted": "movió la fecha de una tarea",
  "task.blockers_changed": "cambió las dependencias de una tarea",
  "task.deleted": "borró una tarea",
  ...CALL_ACTION_LABELS,
  ...COMMISSION_ACTION_LABELS,
  ...FINANCE_ACTION_LABELS,
  ...FORM_ACTION_LABELS,
  ...SALE_ACTION_LABELS,
};

const FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(CONTACT_FIELDS.map((f) => [f.key, f.label])),
  setter_id: "Setter",
  vendedor_id: "Vendedor",
  referred_by_user_id: "Referido por (persona)",
  referred_by_contact_id: "Referido por (contacto)",
  assignment_locked_at: "Asignado a mano",
  do_not_contact: "No contactar",
  do_not_contact_reason: "Motivo de no contactar",
  interest_product: "Producto de interés",
  tags: "Tags",
};

export function HistorySection({ items }: { items: HistoryItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, INITIAL_VISIBLE);
  const hidden = items.length - shown.length;

  return (
    <Section title="Historial">
      {items.length === 0 ? (
        <EmptyHint>
          Todavía no hay nada en el historial de este contacto: ni cambios, ni automatizaciones, ni emails automáticos.
        </EmptyHint>
      ) : (
        <>
          <ol className="space-y-2">
            {shown.map((item) =>
              item.source === "audit" ? (
                <li key={item.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm">
                    <span className="font-medium">{item.actorLabel}</span> {auditText(item)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(item.at)}</p>
                  {renderChanges(item.changes)}
                  {renderLinkNote(item)}
                  {renderImportNote(item)}
                  {renderTagEffectNote(item)}
                </li>
              ) : (
                <li key={item.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm">
                    <span className="font-medium">{describeHistoryItem(item).actor}</span> {describeHistoryItem(item).text}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(item.at)}</p>
                  {item.source === "status" && item.reason && (
                    <p className="mt-1 text-xs text-muted-foreground">Motivo: {item.reason}</p>
                  )}
                </li>
              ),
            )}
          </ol>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Ver más ({hidden})
            </button>
          )}
        </>
      )}
    </Section>
  );
}

/** Lo que hizo una entrada del audit; una automatizacion dice cual (por su nombre). */
function auditText(entry: HistoryEntry): string {
  if (entry.action === "automation_triggered" && entry.flowName) {
    return `disparó la automatización «${entry.flowName}»`;
  }
  // Un contacto que ya existía y vino en una planilla (lib/actions/csv-import.ts).
  const fileName = importFileName(entry);
  if (fileName) return `lo encontró en la importación «${fileName}»`;
  return ACTION_LABELS[entry.action as AuditAction] ?? entry.action;
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

function importFileName({ action, metadata }: HistoryEntry): string | null {
  if (action !== "import" || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const name = (metadata as Record<string, unknown>).file_name;
  return typeof name === "string" && name ? name : null;
}

/**
 * La importación sobre un contacto que ya existía: qué datos completó. No es
 * su origen (no cambia la atribución), solo deja constancia.
 */
function renderImportNote(entry: HistoryEntry) {
  if (!importFileName(entry)) return null;
  const meta = entry.metadata as Record<string, unknown>;
  const filled = Array.isArray(meta.filled) ? (meta.filled as unknown[]).filter((f): f is string => typeof f === "string") : [];
  const labels = filled.map((f) => FIELD_LABELS[f] ?? f.replace(/^custom:/, ""));
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {labels.length > 0 ? `Completó: ${labels.join(", ")}.` : "No completó ningún dato (ya los tenía)."} La atribución
      no cambia: la importación no fue su origen.
    </p>
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

/**
 * Una etiqueta con efecto (00073): las dos consecuencias en lenguaje llano.
 * Lo escriben los triggers de la base, con quien puso o saco la etiqueta.
 */
function renderTagEffectNote({ action, metadata }: HistoryEntry) {
  if (action !== "tag_effect" || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const meta = metadata as Record<string, unknown>;
  const tag = typeof meta.tag_name === "string" ? `«${meta.tag_name}»` : "una etiqueta borrada";
  const count = (key: string) => (Array.isArray(meta[key]) ? (meta[key] as unknown[]).length : 0);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (meta.removed === true) {
    const restored = count("conversations_restored");
    const still = count("conversations_still_disabled");
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Se sacó {tag}.{" "}
        {still > 0
          ? `El agente sigue apagado en ${plural(still, "conversación", "conversaciones")} por otra etiqueta.`
          : restored > 0
            ? `${plural(restored, "conversación volvió", "conversaciones volvieron")} a heredar el agente del canal.`
            : "No había conversaciones apagadas por la etiqueta."}{" "}
        La asignación no cambia.
      </p>
    );
  }

  const off = count("conversations_forced_off");
  const origin = meta.origin === "new_conversation" ? " (conversación nueva)" : meta.origin === "contact_merge" ? " (fusión de contactos)" : "";
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {tag}
      {origin}:{" "}
      {off > 0 ? `el agente quedó apagado en ${plural(off, "conversación", "conversaciones")}` : "sin conversaciones para apagar"}
      {typeof meta.assigned_to === "string" ? "; setter y vendedor pasaron a la persona de la etiqueta." : "."}
    </p>
  );
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "vacío";
  if (typeof value === "boolean") return value ? "sí" : "no";
  return String(value);
}
