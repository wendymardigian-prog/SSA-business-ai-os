"use client";

import { useViewerTimezone } from "@/components/dashboard-chrome";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2 } from "lucide-react";
import { setContactStatus } from "@/lib/actions/contact-status";
import { assignContact } from "@/lib/actions/contacts";
import { SELF_REMOVAL_MESSAGE, needsSelfRemovalConfirm } from "@/lib/contacts/assignment-confirm";
import type { TeamMember } from "@/lib/inbox/assignee";
import { MemberPicker } from "./member-picker";
import {
  STATUS_ROLES,
  STATUS_ROLE_LABELS,
  activeStatuses,
  findStatus,
  statusColor,
  statusName,
  type ContactStatusSettings,
  type StatusRole,
} from "@/lib/contacts/statuses";
import { ActionError, formatRelative } from "./ui";

/** Lo que estos componentes necesitan del contacto (las columnas de la 00245). */
export interface ContactStatusValues {
  setter_status: string | null;
  setter_status_at: string | null;
  setter_status_by_agent: boolean;
  closer_status: string | null;
  closer_status_at: string | null;
  last_status_role: StatusRole | null;
  last_status: string | null;
  last_status_at: string | null;
}

/**
 * El ÚLTIMO estado del contacto (el que se cambió más recientemente de los
 * dos), como etiqueta: "Calificado · Setter · Hoy". Sin estado, nada.
 */
export function LastStatusBadge({
  settings,
  role,
  status,
  at,
  compact = false,
}: {
  settings: ContactStatusSettings;
  role: StatusRole | null;
  status: string | null;
  at?: string | null;
  /** En la lista: sin la fecha. */
  compact?: boolean;
}) {
  const timeZone = useViewerTimezone();
  if (!role || !status) return null;
  const list = settings[role];
  const color = statusColor(list, status);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium"
      title={`Último estado: ${statusName(list, status)} (${STATUS_ROLE_LABELS[role].toLowerCase()})`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span className="truncate">{statusName(list, status)}</span>
      <span className="shrink-0 text-muted-foreground">· {STATUS_ROLE_LABELS[role]}</span>
      {!compact && at && <span className="shrink-0 text-muted-foreground">· {formatRelative(at, timeZone)}</span>}
    </span>
  );
}

/**
 * Quien tiene el lead en cada rol, para el selector chico que va a la par de cada estado. El setter
 * es quien contacta y califica; el vendedor, quien cierra (`closer`, en los estados).
 */
export interface StatusAssignment {
  members: TeamMember[];
  setterId: string | null;
  vendedorId: string | null;
  currentUserId: string;
  /** Para el aviso al sacarse a uno mismo de un lead (como en «Asignación»). */
  isAdmin: boolean;
  /** `contacts.assign`: sin ella se ve la foto, sin menu. */
  canAssign: boolean;
}

/**
 * Los dos selectores: estado de setter y estado de vendedor. Se guardan al
 * cambiar el desplegable (como la asignación). Un estado archivado que el
 * contacto ya tiene se sigue viendo, pero no se ofrece para elegir.
 */
export function StatusFields({
  contactId,
  settings,
  values,
  canEdit,
  onSaved,
  assignment,
}: {
  contactId: string;
  settings: ContactStatusSettings;
  values: ContactStatusValues;
  canEdit: boolean;
  /** Después de guardar (el panel de la bandeja carga sus datos en el navegador). */
  onSaved?: () => void;
  /** Con esto, a la par de cada estado va quien tiene el lead (foto sola; el menu dice el nombre). */
  assignment?: StatusAssignment;
}) {
  const timeZone = useViewerTimezone();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<StatusRole | null>(null);
  const [pending, start] = useTransition();
  const [assigning, startAssign] = useTransition();
  const [assigningRole, setAssigningRole] = useState<StatusRole | null>(null);
  // Optimista: la foto cambia al elegir y vuelve atras si falla (como el responsable del chat).
  const [shownAssign, setShownAssign] = useState<{ setter: string | null; closer: string | null } | null>(null);

  // Cuando llegan los datos nuevos (la ficha o el panel recargaron), el valor optimista ya no hace falta.
  const assignKey = `${assignment?.setterId ?? ""}|${assignment?.vendedorId ?? ""}`;
  const [lastAssignKey, setLastAssignKey] = useState(assignKey);
  if (assignKey !== lastAssignKey) {
    setLastAssignKey(assignKey);
    setShownAssign(null);
  }

  function assign(role: StatusRole, next: string | null) {
    if (!assignment) return;
    const current = role === "setter" ? assignment.setterId : assignment.vendedorId;
    const other = role === "setter" ? assignment.vendedorId : assignment.setterId;
    if (
      needsSelfRemovalConfirm({ isAdmin: assignment.isAdmin, currentUserId: assignment.currentUserId, next, current, other }) &&
      !window.confirm(SELF_REMOVAL_MESSAGE)
    ) {
      return;
    }
    setAssigningRole(role);
    setShownAssign({ setter: assignment.setterId, closer: assignment.vendedorId, [role]: next });
    startAssign(async () => {
      const result = await assignContact(contactId, { [role === "setter" ? "setter_id" : "vendedor_id"]: next });
      setAssigningRole(null);
      if (!result.ok) {
        setShownAssign(null);
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
      onSaved?.();
    });
  }

  function change(role: StatusRole, value: string) {
    setSavingRole(role);
    start(async () => {
      const result = await setContactStatus(contactId, role, value || null);
      setSavingRole(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <div className="space-y-3">
      {STATUS_ROLES.map((role) => {
        const list = settings[role];
        const current = role === "setter" ? values.setter_status : values.closer_status;
        const at = role === "setter" ? values.setter_status_at : values.closer_status_at;
        const options = activeStatuses(list);
        const currentIsOffered = !current || options.some((s) => s.key === current);
        const id = `status-${role}-${contactId}`;
        return (
          <div key={role}>
            <label htmlFor={id} className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Estado de {STATUS_ROLE_LABELS[role].toLowerCase()}
              {pending && savingRole === role && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            </label>
            <div className="flex items-center gap-2">
              {current && (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: statusColor(list, current) }} aria-hidden />
              )}
              <select
                id={id}
                value={current ?? ""}
                disabled={!canEdit || pending}
                onChange={(e) => change(role, e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              >
                <option value="">Sin estado</option>
                {options.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
                {!currentIsOffered && current && <option value={current}>{statusName(list, current)}</option>}
              </select>
              {assignment && (
                <MemberPicker
                  value={
                    shownAssign
                      ? role === "setter" ? shownAssign.setter : shownAssign.closer
                      : role === "setter" ? assignment.setterId : assignment.vendedorId
                  }
                  members={assignment.members}
                  currentUserId={assignment.currentUserId}
                  canAssign={assignment.canAssign}
                  pending={assigning && assigningRole === role}
                  label={role === "setter" ? "Setter" : "Vendedor"}
                  groupLabel={role === "setter" ? "Setter · quien contacta y califica" : "Vendedor · quien cierra"}
                  onChange={(next) => assign(role, next)}
                />
              )}
            </div>
            {current && at && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/70">
                {role === "setter" && values.setter_status_by_agent && (
                  <span className="inline-flex items-center gap-0.5" title="Lo puso el agente de IA">
                    <Bot className="h-3 w-3" aria-hidden />
                    Agente IA ·
                  </span>
                )}
                Desde: {formatRelative(at, timeZone)}
                {!findStatus(list, current) && " · ese estado ya no existe en la lista"}
              </p>
            )}
            {options.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground/70">No hay estados activos: se configuran en Ajustes → Estados.</p>
            )}
          </div>
        );
      })}
      <ActionError message={error} />
    </div>
  );
}
