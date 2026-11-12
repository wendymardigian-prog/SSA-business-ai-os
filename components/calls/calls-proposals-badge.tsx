"use client";
// @plantilla-quitar(servicios)

import { useEffect, useState } from "react";
import { countMyPendingProposals } from "@/lib/actions/calls-badge";
import { badgeLabel } from "@/lib/calls/activity";

/**
 * El número de Grabaciones en el menú (Servicios A4, F145): reuniones con propuestas por aprobar donde soy el
 * responsable del servicio o quien grabó. Se pide al montar y cada 2 minutos; sin nada pendiente no se dibuja.
 */
export function CallsProposalsBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => void countMyPendingProposals().then((n) => alive && setCount(n));
    load();
    const t = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const label = badgeLabel(count);
  if (!label) return null;
  return (
    <span
      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground collapsed:right-1 collapsed:top-1 collapsed:translate-y-0"
      title={`${label} reunión(es) con propuestas por aprobar`}
      aria-label={`${label} reunión(es) con propuestas por aprobar`}
    >
      {label}
    </span>
  );
}
