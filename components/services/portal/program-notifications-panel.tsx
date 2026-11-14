"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProgramSettings } from "@/lib/actions/services";

/**
 * Avisos por email del programa (F128). El resumen semanal de los lunes (8:00 en la zona de cada estudiante) nace
 * APAGADO; cada estudiante, además, puede apagarlo desde su Perfil. Sale con el Resend del negocio; sin Resend no sale
 * nada y queda en el registro de emails. («Lo que vence hoy» por email se suma cuando tenga su envío.)
 */
export function ProgramNotificationsPanel({
  productId,
  notifications,
  rev,
  canEdit,
}: {
  productId: string;
  notifications: { weekly_digest?: boolean; due_today_email?: boolean };
  rev: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (patch: Record<string, boolean>) =>
    start(async () => {
      setMsg(null);
      const res = await saveProgramSettings(productId, { notifications: { weekly_digest: false, due_today_email: false, ...notifications, ...patch } }, rev);
      if (!res.ok) return setMsg(res.error.message);
      const d = res.data as { status: string; problems?: string[] };
      if (d.status !== "ok") return setMsg(d.status === "conflict" ? "Alguien cambió el programa mientras lo editabas. Recargá la página." : (d.problems ?? []).join(". "));
      router.refresh();
    });
  return (
    <div className="max-w-2xl space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notifications.weekly_digest === true} disabled={!canEdit || pending} onChange={(e) => save({ weekly_digest: e.target.checked })} />
        Resumen semanal por email (los lunes)
      </label>
      <p className="text-xs text-muted-foreground">Apagarlo acá lo apaga para todos. Cada estudiante también puede apagarlo desde su Perfil. Sale con el Resend del negocio.</p>
      {msg && (
        <p role="alert" className="text-sm text-destructive">
          {msg}
        </p>
      )}
    </div>
  );
}
