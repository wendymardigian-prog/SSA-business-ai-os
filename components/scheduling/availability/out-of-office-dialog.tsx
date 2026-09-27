"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ContentDialog, DialogField } from "@/components/content/dialog";
import { Switch } from "@/components/ui/switch";
import { TimeSelect } from "./time-select";
import { OUT_OF_OFFICE_REASON_LABELS, OUT_OF_OFFICE_REASONS } from "@/lib/scheduling/out-of-office";
import { dateInTz, minutesOfDayInTz, minutesToWallTime } from "@/lib/scheduling/time/tz";
import { formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { previewOutOfOfficeConflicts, saveOutOfOffice } from "@/lib/actions/scheduling/out-of-office";
import type { ConflictingBooking, OutOfOfficeRow } from "@/lib/scheduling/data/schedules";
import type { OutOfOfficeReason } from "@/lib/types/database";

/**
 * Modal "Agregar tiempo fuera" (F13): fechas, dias completos o con hora,
 * motivo, nota y el aviso de agendas en el periodo (no bloquea).
 */
export function OutOfOfficeDialog({
  timezone,
  scheduleNames,
  editing,
  forUserId,
  onClose,
  onSaved,
}: {
  timezone: string;
  scheduleNames: string[];
  editing?: OutOfOfficeRow | null;
  forUserId?: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const today = dateInTz(new Date(), timezone);
  const [from, setFrom] = useState(editing ? dateInTz(editing.starts_at, timezone) : today);
  const [to, setTo] = useState(editing ? dateInTz(new Date(new Date(editing.ends_at).getTime() - (editing.all_day ? 1 : 0)), timezone) : today);
  const [allDay, setAllDay] = useState(editing ? editing.all_day : true);
  const [fromTime, setFromTime] = useState(editing && !editing.all_day ? minutesToWallTime(minutesOfDayInTz(editing.starts_at, timezone)) : "09:00");
  const [toTime, setToTime] = useState(editing && !editing.all_day ? minutesToWallTime(minutesOfDayInTz(editing.ends_at, timezone)) : "18:00");
  const [reason, setReason] = useState<OutOfOfficeReason>(editing?.reason ?? "vacation");
  const [note, setNote] = useState(editing?.note ?? "");
  const [conflicts, setConflicts] = useState<ConflictingBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const complete = Boolean(from && to && (allDay || (fromTime && toTime)));

  useEffect(() => {
    if (!complete) return;
    let cancelled = false;
    previewOutOfOfficeConflicts({ from, to, allDay, fromTime, toTime, forUserId }).then((r) => {
      if (cancelled) return;
      if (r.ok) setConflicts(r.data.conflictingBookings);
    });
    return () => {
      cancelled = true;
    };
  }, [from, to, allDay, fromTime, toTime, forUserId, complete]);

  function save() {
    setError(null);
    start(async () => {
      const result = await saveOutOfOffice({ id: editing?.id ?? null, from, to, allDay, fromTime, toTime, reason, note, forUserId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(editing ? "Tiempo fuera guardado" : "Tiempo fuera agregado");
    });
  }

  const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

  return (
    <ContentDialog
      title={
        <span>
          {editing ? "Editar tiempo fuera" : "Agregar tiempo fuera"}
          <span className="block text-xs font-normal text-muted-foreground">
            Aplica a <strong>todos tus horarios</strong>{scheduleNames.length > 0 ? ` (${scheduleNames.join(", ")})` : ""} y a todos tus eventos
          </span>
        </span>
      }
      label={editing ? "Editar tiempo fuera" : "Agregar tiempo fuera"}
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <button type="button" data-close onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm">Cancelar</button>
          <button type="button" onClick={save} disabled={pending || !complete} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Guardar tiempo fuera
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <DialogField label="Desde">
            <input type="date" value={from} min={editing ? undefined : today} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </DialogField>
          <DialogField label="Hasta">
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </DialogField>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={allDay} label="Días completos (en tu zona)" onChange={setAllDay} />
          <span className="text-sm">Días completos (en tu zona)</span>
        </div>
        {!allDay && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">De</span>
            <TimeSelect label="Hora de inicio" value={fromTime} onChange={setFromTime} />
            <span className="text-muted-foreground">a</span>
            <TimeSelect label="Hora de fin" value={toTime} isEnd onChange={setToTime} />
          </div>
        )}
        <div>
          <p className="text-xs font-medium">Motivo</p>
          <div role="radiogroup" aria-label="Motivo" className="mt-1 flex flex-wrap gap-2">
            {OUT_OF_OFFICE_REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={`rounded-full border px-3 py-1 text-sm ${reason === r ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted"}`}>
                {OUT_OF_OFFICE_REASON_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
        <DialogField label="Nota privada (opcional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputClass} placeholder="Solo la ves vos" />
        </DialogField>
        {conflicts.length > 0 && (
          <div role="status" className="rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-950/40">
            <p className="font-medium">Tenés {conflicts.length} {conflicts.length === 1 ? "agenda" : "agendas"} en ese período</p>
            <ul className="mt-1 space-y-1">
              {conflicts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span>{formatDateTimeWithZone(c.start_at, timezone)} · {c.contact_name ?? "Sin nombre"} ({c.event_title ?? "evento"})</span>
                  <Link href={`/dashboard/agenda?agenda=${c.id}`} className="text-primary underline">Reagendar</Link>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">No se cancelan solas: reagendalas o cancelalas si hace falta.</p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </ContentDialog>
  );
}
