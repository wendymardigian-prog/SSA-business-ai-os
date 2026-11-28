"use client";

/**
 * «Qué mostrar» del calendario de la Agenda: un desplegable de selección múltiple con las reuniones del sistema (todas
 * o estado por estado, agrupados), las tareas (mías o todas), los eventos de Google y las clases en vivo del Portal. Los estados son el mismo filtro
 * «Estado» del menú Filtros (`?estado=`); las reglas, en `lib/scheduling/calendar-show.ts`.
 */
import { useEffect, useRef } from "react";
import { ChevronDown, Eye } from "lucide-react";
import { PortalMenu, PortalMenuLabel, PortalMenuSeparator } from "@/components/ui/portal-menu";
import { BOOKING_STATUSES, STATUS_GROUP_LABELS, STATUS_GROUPS, statusesInGroup } from "@/lib/scheduling/booking-status";
import { visibleCalendarStatuses } from "@/lib/scheduling/calendar-show";
import type { BookingStatus } from "@/lib/scheduling/types";
import { cn } from "@/lib/utils";

type TasksMode = "off" | "mine" | "all";

/** Una casilla con estado intermedio (cuando un grupo está a medias). */
function Check({ checked, indeterminate = false, disabled = false, label, onChange, strong = false }: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
  strong?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-0.5 text-[13px] leading-6 hover:bg-accent", disabled && "cursor-not-allowed opacity-50", strong && "font-medium")}>
      <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--primary)]" />
      <span className="min-w-0 flex-1">{label}</span>
    </label>
  );
}

export function CalendarShowMenu({
  statuses,
  meetingsShown,
  onStatuses,
  onMeetings,
  tasks,
  google,
  liveClasses,
}: {
  /** El filtro «Estado» (vacío = todo menos las canceladas). */
  statuses: BookingStatus[];
  meetingsShown: boolean;
  onStatuses: (next: BookingStatus[]) => void;
  onMeetings: (shown: boolean) => void;
  /** Sin esto (sin permiso de tareas), no hay sección de tareas. */
  tasks?: { mode: TasksMode; onMode: (mode: TasksMode) => void };
  /** Sin esto (sin Google), no hay sección de Google. */
  google?: { on: boolean; onToggle: (on: boolean) => void };
  /** Sin esto (sin el módulo de Servicios), no hay sección de clases. */
  liveClasses?: { on: boolean; onToggle: (on: boolean) => void };
}) {
  const visible = meetingsShown ? visibleCalendarStatuses(statuses) : [];
  const layers = (meetingsShown ? 1 : 0) + (tasks && tasks.mode !== "off" ? 1 : 0) + (google?.on ? 1 : 0) + (liveClasses?.on ? 1 : 0);

  const setStatus = (status: BookingStatus, on: boolean) => onStatuses(on ? [...visible, status] : visible.filter((s) => s !== status));
  const setGroup = (group: (typeof STATUS_GROUPS)[number], on: boolean) => {
    const inGroup = statusesInGroup(group);
    onStatuses(on ? [...new Set([...visible, ...inGroup])] : visible.filter((s) => !inGroup.includes(s)));
  };

  return (
    <PortalMenu
      label="Qué mostrar en el calendario"
      width={280}
      maxHeight={460}
      align="end"
      trigger={
        <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted">
          <Eye className="h-3.5 w-3.5" aria-hidden /> Qué mostrar
          <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">{layers}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </span>
      }
    >
      <PortalMenuLabel>Reuniones del sistema</PortalMenuLabel>
      <Check
        strong
        label="Todas las reuniones"
        checked={meetingsShown && visible.length === BOOKING_STATUSES.length}
        indeterminate={meetingsShown && visible.length > 0 && visible.length < BOOKING_STATUSES.length}
        onChange={(on) => {
          if (on) {
            onStatuses(BOOKING_STATUSES.map((s) => s.key));
            if (!meetingsShown) onMeetings(true);
          } else onMeetings(false);
        }}
      />
      {STATUS_GROUPS.map((group) => {
        const inGroup = statusesInGroup(group);
        const count = inGroup.filter((s) => visible.includes(s)).length;
        return (
          <div key={group} className="pl-3">
            {inGroup.length > 1 && (
              <Check
                label={STATUS_GROUP_LABELS[group]}
                checked={count === inGroup.length}
                indeterminate={count > 0 && count < inGroup.length}
                onChange={(on) => setGroup(group, on)}
              />
            )}
            <div className={cn(inGroup.length > 1 && "pl-3")}>
              {BOOKING_STATUSES.filter((s) => s.group === group).map((s) => (
                <Check key={s.key} label={s.label} checked={visible.includes(s.key)} onChange={(on) => setStatus(s.key, on)} />
              ))}
            </div>
          </div>
        );
      })}

      {tasks && (
        <>
          <PortalMenuSeparator />
          <PortalMenuLabel>Tareas</PortalMenuLabel>
          <Check strong label="Tareas" checked={tasks.mode !== "off"} onChange={(on) => tasks.onMode(on ? "mine" : "off")} />
          {tasks.mode !== "off" && (
            <div className="flex gap-3 pl-8 text-sm" role="radiogroup" aria-label="Qué tareas">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={tasks.mode === "mine"} onChange={() => tasks.onMode("mine")} /> Mías
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={tasks.mode === "all"} onChange={() => tasks.onMode("all")} /> Todas las que veo
              </label>
            </div>
          )}
        </>
      )}

      {google && (
        <>
          <PortalMenuSeparator />
          <PortalMenuLabel>Google Calendar</PortalMenuLabel>
          <Check strong label="Eventos de Google (no están en el sistema)" checked={google.on} onChange={google.onToggle} />
        </>
      )}

      {liveClasses && (
        <>
          <PortalMenuSeparator />
          <PortalMenuLabel>Portal</PortalMenuLabel>
          <Check strong label="Clases en vivo que das" checked={liveClasses.on} onChange={liveClasses.onToggle} />
        </>
      )}
    </PortalMenu>
  );
}
