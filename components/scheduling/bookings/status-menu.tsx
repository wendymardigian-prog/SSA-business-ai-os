"use client";

/**
 * El chip de estado que se puede tocar: abre un menu con los estados a los que
 * se puede pasar, sin abrir el detalle de la agenda.
 *
 * Lo usan la lista («Estado») y el tablero («Sin resultado»). Las reglas de que
 * cambio se puede hacer son las de siempre (`evaluateTransition`, la misma que
 * valida el servidor): lo que todavia no se puede aparece apagado con el motivo,
 * en vez de esconderse. Si quien mira no puede cambiar estados, o la agenda esta
 * cancelada (es final), el chip se ve igual pero no hace nada.
 */

import { Fragment } from "react";
import type { BookingStatus } from "@/lib/scheduling/types";
import { BOOKING_STATUSES, evaluateTransition, groupOf, TRANSITION_REASON_TEXT } from "@/lib/scheduling/booking-status";
import { PortalMenu, PortalMenuItem, PortalMenuSeparator } from "@/components/ui/portal-menu";
import { NeedsOutcomeChip, StatusChip, statusDotClass } from "./status-chip";

export function StatusMenu({
  status,
  startAt,
  now,
  canChange,
  busy = false,
  variant = "status",
  onSelect,
}: {
  status: BookingStatus;
  startAt: string;
  now: Date;
  /** `scheduling.manage` (o el permiso que hoy deja cambiar el estado). Sin el, el chip es solo una etiqueta. */
  canChange: boolean;
  /** Mientras se guarda un cambio, el chip no se puede volver a tocar. */
  busy?: boolean;
  /** `needs_outcome`: la pastilla ambar «Sin resultado» abre el mismo menu. */
  variant?: "status" | "needs_outcome";
  /** Ya validado: elegir una cancelacion lo resuelve quien llama (pide el motivo). */
  onSelect: (to: BookingStatus) => void;
}) {
  const chip = (withChevron: boolean) => (variant === "needs_outcome" ? <NeedsOutcomeChip withChevron={withChevron} /> : <StatusChip status={status} withChevron={withChevron} />);

  if (!canChange || groupOf(status) === "cancelled") {
    return <span title={groupOf(status) === "cancelled" ? "Una cancelación es final" : undefined}>{chip(false)}</span>;
  }

  return (
    <PortalMenu
      label="Cambiar el estado"
      title="Cambiar el estado"
      disabled={busy}
      width={256}
      triggerClassName="rounded-full hover:brightness-110 disabled:opacity-60"
      trigger={chip(true)}
    >
      {BOOKING_STATUSES.map((def, i) => {
        const verdict = evaluateTransition(status, def.key, { start_at: startAt }, now);
        const current = def.key === status;
        const previous = BOOKING_STATUSES[i - 1];
        return (
          <Fragment key={def.key}>
            {previous && previous.group !== def.group && <PortalMenuSeparator />}
            <PortalMenuItem
              selected={current}
              // Lo actual se ve elegido, no apagado: no hay nada que cambiar pero tampoco esta "prohibido".
              disabled={!current && !verdict.ok}
              title={!current && !verdict.ok && verdict.reason ? TRANSITION_REASON_TEXT[verdict.reason] : undefined}
              onSelect={() => {
                if (!current) onSelect(def.key);
              }}
            >
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(def.key)}`} />
              <span className="truncate">{def.label}</span>
            </PortalMenuItem>
          </Fragment>
        );
      })}
    </PortalMenu>
  );
}
