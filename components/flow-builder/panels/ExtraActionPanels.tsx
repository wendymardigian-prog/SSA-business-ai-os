"use client";

import { useEffect, useState } from "react";
import { loadTeamMemberOptions } from "@/lib/actions/flow-node-options";
import { BOOKING_STATUSES } from "@/lib/scheduling/booking-status";
import { VariableChips } from "./variable-chips";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";

type PanelProps = { data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void; availableVariables?: string[] };

/**
 * «Avisar en la campana» en el lienzo.
 */
export function NotifyTeamPanel({ data, onChange, availableVariables }: PanelProps) {
  const [members, setMembers] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => {
    let alive = true;
    loadTeamMemberOptions()
      .then((o) => alive && setMembers(o.members))
      .catch(() => alive && setMembers([]));
    return () => {
      alive = false;
    };
  }, []);
  const to = String(data.to ?? "users");
  const userIds = Array.isArray(data.userIds) ? (data.userIds as string[]) : [];
  const toggle = (id: string) => onChange({ ...data, userIds: userIds.includes(id) ? userIds.filter((u) => u !== id) : [...userIds, id] });

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="nt-to" className={labelClass}>Para</label>
        <select id="nt-to" value={to} onChange={(e) => onChange({ ...data, to: e.target.value })} className={inputClass}>
          <option value="users">Personas elegidas</option>
          <option value="reporter">Quien envió el reporte (flujos de fin de día)</option> {/* @plantilla-quitar(formularios) */}
          <option value="both">Quien envió el reporte y personas elegidas</option> {/* @plantilla-quitar(formularios) */}
          <option value="service_owner">El responsable del servicio</option> {/* @plantilla-quitar(servicios) */}
        </select>
      </div>
      {/* @plantilla-desde(servicios) */}
      {to === "service_owner" && (
        <div>
          <label htmlFor="nt-fallback" className={labelClass}>Si el servicio no tiene responsable</label>
          <select id="nt-fallback" value={String(data.fallbackUserId ?? "")} onChange={(e) => onChange({ ...data, fallbackUserId: e.target.value })} className={inputClass}>
            <option value="">{members === null ? "Cargando…" : "Elegí una persona (obligatorio)"}</option>
            {(members ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* @plantilla-hasta(servicios) */}
      {to !== "reporter" && to !== "service_owner" && (
        <fieldset>
          <legend className={labelClass}>Personas del equipo</legend>
          {members === null ? (
            <p className="text-xs text-muted-foreground">Cargando el equipo…</p>
          ) : members.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay personas en el equipo para elegir.</p>
          ) : (
            <div className="space-y-1">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={userIds.includes(m.id)} onChange={() => toggle(m.id)} className="h-4 w-4 rounded border-input" />
                  {m.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      <div>
        <label htmlFor="nt-title" className={labelClass}>Título</label>
        <input id="nt-title" maxLength={200} value={String(data.title ?? "")} onChange={(e) => onChange({ ...data, title: e.target.value })} placeholder="Nuevo lead de {{contact.display_name}}" className={inputClass} />
        <VariableChips variables={availableVariables} onInsert={(token) => onChange({ ...data, title: `${String(data.title ?? "")}${token}` })} />
        <p className="mt-1.5 text-xs text-muted-foreground">Sin título no se avisa nada.</p>
      </div>
      <div>
        <label htmlFor="nt-body" className={labelClass}>Texto (opcional)</label>
        <textarea id="nt-body" rows={3} maxLength={1000} value={String(data.body ?? "")} onChange={(e) => onChange({ ...data, body: e.target.value })} className={inputClass} />
      </div>
    </div>
  );
}

const CANCEL_STATUSES = BOOKING_STATUSES.filter((s) => s.group === "cancelled");

/** «Cancelar la reunión»: la que disparó la automatización (un flujo de agenda). */
export function CancelBookingPanel({ data, onChange, availableVariables }: PanelProps) {
  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
        Cancela la reunión que disparó esta automatización, igual que si la cancelara alguien del equipo (avisa al
        invitado y saca el evento del calendario). Solo sirve en automatizaciones de agenda.
      </p>
      <div>
        <label htmlFor="cb-status" className={labelClass}>Motivo de la cancelación</label>
        <select id="cb-status" value={String(data.status ?? "cancelled_other")} onChange={(e) => onChange({ ...data, status: e.target.value })} className={inputClass}>
          {CANCEL_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="cb-reason" className={labelClass}>Nota (queda en el historial)</label>
        <input id="cb-reason" value={String(data.reason ?? "")} onChange={(e) => onChange({ ...data, reason: e.target.value })} placeholder="Cancelada por una automatización" className={inputClass} />
        <VariableChips variables={availableVariables} onInsert={(token) => onChange({ ...data, reason: `${String(data.reason ?? "")}${token}` })} />
      </div>
    </div>
  );
}

/** «Cambiar estado de la reunión»: la que disparó la automatización. */
export function SetBookingStatusPanel({ data, onChange }: PanelProps) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="sbs-status" className={labelClass}>Pasar la reunión a</label>
        <select id="sbs-status" value={String(data.status ?? "")} onChange={(e) => onChange({ ...data, status: e.target.value })} className={inputClass}>
          <option value="">Elegí un estado</option>
          {BOOKING_STATUSES.filter((s) => s.group !== "cancelled").map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-muted-foreground">Sin estado el paso no hace nada. Para cancelar, usá «Cancelar la reunión».</p>
      </div>
    </div>
  );
}

/**
 * «Enviar a Slack» en el lienzo (Servicios A4, F158): a un canal (su ID o #nombre) o, por mensaje directo, a una
 * persona del equipo que cargó su ID de Slack en Mi cuenta.
 */
export function SendSlackPanel({ data, onChange, availableVariables }: PanelProps) {
  const [members, setMembers] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => {
    let alive = true;
    loadTeamMemberOptions()
      .then((o) => alive && setMembers(o.members))
      .catch(() => alive && setMembers([]));
    return () => {
      alive = false;
    };
  }, []);
  const target = String(data.target ?? "channel");
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="sl-target" className={labelClass}>A dónde</label>
        <select id="sl-target" value={target} onChange={(e) => onChange({ ...data, target: e.target.value })} className={inputClass}>
          <option value="channel">Un canal de Slack</option>
          <option value="person">Una persona del equipo (mensaje directo)</option>
        </select>
      </div>
      {target === "channel" ? (
        <div>
          <label htmlFor="sl-channel" className={labelClass}>Canal</label>
          <input id="sl-channel" value={String(data.channel ?? "")} onChange={(e) => onChange({ ...data, channel: e.target.value.trim() })} placeholder="C0123ABCD o #ventas" className={inputClass} />
          <p className="mt-1.5 text-xs text-muted-foreground">El bot de Slack tiene que estar invitado al canal.</p>
        </div>
      ) : (
        <div>
          <label htmlFor="sl-user" className={labelClass}>Persona</label>
          <select id="sl-user" value={String(data.userId ?? "")} onChange={(e) => onChange({ ...data, userId: e.target.value })} className={inputClass}>
            <option value="">{members === null ? "Cargando…" : "Elegí una persona"}</option>
            {(members ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">Le llega solo si cargó su ID de Slack en Mi cuenta.</p>
        </div>
      )}
      <div>
        <label htmlFor="sl-text" className={labelClass}>Mensaje</label>
        <textarea id="sl-text" rows={4} maxLength={3000} value={String(data.text ?? "")} onChange={(e) => onChange({ ...data, text: e.target.value })} placeholder="Nuevo cliente: {{contact.display_name}}" className={inputClass} />
        <VariableChips variables={availableVariables} onInsert={(token) => onChange({ ...data, text: `${String(data.text ?? "")}${token}` })} />
      </div>
    </div>
  );
}
