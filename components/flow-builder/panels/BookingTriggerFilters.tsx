"use client";

import { useEffect, useState } from "react";
import { loadBookingTriggerOptions } from "@/lib/actions/scheduling/trigger-options";
import { BOOKING_STATUSES, STATUS_GROUPS, STATUS_GROUP_LABELS } from "@/lib/scheduling/booking-status";
import { MultiPick } from "./multi-pick";
import { useTeamOptions } from "./use-trigger-options";

type Option = { value: string; label: string };

/**
 * Los filtros de Agenda que el motor ya leía y el lienzo no dejaba elegir: evento, anfitrión, área o tipo, «sin
 * evento» y, en «Cambió el estado», a qué estado pasó, desde cuál y a qué grupo. Vacío = cualquiera.
 */
export function BookingTriggerFilters({ triggerType, data, onChange }: { triggerType: string; data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const team = useTeamOptions();
  const [options, setOptions] = useState<{ eventTypes: Option[]; categories: Option[] } | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    loadBookingTriggerOptions()
      .then((r) => {
        if (!alive) return;
        setOptions(r.ok ? { eventTypes: r.eventTypes.map((e) => ({ value: e.id, label: e.name })), categories: r.categories.map((c) => ({ value: c.id, label: c.name })) } : null);
      })
      .catch(() => alive && setOptions(null));
    return () => {
      alive = false;
    };
  }, []);

  const list = (key: string) => (Array.isArray(data[key]) ? (data[key] as unknown[]).filter((v): v is string => typeof v === "string") : []);
  const setList = (key: string) => (next: string[]) => onChange({ ...data, [key]: next.length ? next : undefined });
  const statuses: Option[] = BOOKING_STATUSES.map((s) => ({ value: s.key, label: s.label }));
  const groups: Option[] = STATUS_GROUPS.map((g) => ({ value: g, label: STATUS_GROUP_LABELS[g] }));

  return (
    <div className="space-y-3">
      {options === null && <p role="alert" className="text-xs text-destructive">No pude cargar los eventos y las áreas. Cerrá el panel y volvé a abrirlo.</p>}
      <MultiPick label="Solo estos eventos" value={list("event_type_ids")} options={options?.eventTypes ?? []} loaded={options !== undefined} onChange={setList("event_type_ids")} />
      <label className="flex items-start gap-2 text-xs text-foreground">
        <input type="checkbox" checked={data.no_event === true} onChange={(e) => onChange({ ...data, no_event: e.target.checked ? true : undefined })} className="mt-0.5 size-4 shrink-0" />
        <span>Solo reuniones agendadas sin evento (a mano, «sin evento»)</span>
      </label>
      <MultiPick label="Solo estas áreas o tipos" value={list("category_ids")} options={options?.categories ?? []} loaded={options !== undefined} onChange={setList("category_ids")} />
      <MultiPick label="Solo con este anfitrión" value={list("host_user_ids")} options={team ?? []} loaded={team !== undefined} onChange={setList("host_user_ids")} />
      {triggerType === "booking_status_changed" && (
        <>
          <MultiPick label="Pasó al estado" value={list("to_status")} options={statuses} onChange={setList("to_status")} />
          <MultiPick label="O a cualquier estado de" value={list("to_group")} options={groups} onChange={setList("to_group")} />
          <MultiPick label="Venía del estado" value={list("from_status")} options={statuses} onChange={setList("from_status")} />
        </>
      )}
    </div>
  );
}
