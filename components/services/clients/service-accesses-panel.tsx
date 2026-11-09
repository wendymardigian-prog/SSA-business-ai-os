"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extendAccess, giveAccessNow, grantExtraAccess, revokeAccess } from "@/lib/actions/portal-admin";
import { AVAILABLE_SECTIONS, SECTION_LABELS } from "@/lib/services/availability";
import type { AccessViewRow } from "@/lib/portal-admin/accesses-view";
import { fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";

type Dialog = { kind: "extra" } | { kind: "extend"; row: AccessViewRow } | { kind: "revoke"; row: AccessViewRow } | null;

const STATE_TONE: Record<string, string> = {
  active: "text-foreground",
  expiring: "text-foreground",
  expired: "text-muted-foreground",
  suspended_pause: "text-muted-foreground",
  suspended_overdue: "text-destructive",
  revoked: "text-muted-foreground",
};

/**
 * La pestaña Accesos de la ficha del servicio (F40): los accesos del estudiante al portal y los que todavía no se
 * abrieron. Con `services.access`: dar un acceso extra, extender, quitar y dar ahora, siempre con motivo (queda en
 * el historial).
 */
export function ServiceAccessesPanel({
  serviceId,
  rows,
  pending,
  canManage,
}: {
  serviceId: string;
  rows: AccessViewRow[];
  pending: Array<{ section: string; sectionLabel: string; opensLabel: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [section, setSection] = useState<string>("program");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingTx, start] = useTransition();

  function open(d: Dialog) {
    setDialog(d);
    setDate("");
    setReason("");
    setError(null);
  }

  function submit() {
    if (!dialog) return;
    setError(null);
    start(async () => {
      const res =
        dialog.kind === "extra"
          ? await grantExtraAccess(serviceId, { section, endsOn: date || null, reason })
          : dialog.kind === "extend"
            ? await extendAccess(serviceId, dialog.row.id, date, reason)
            : await revokeAccess(serviceId, dialog.row.id, reason);
      if (!res.ok) return setError(res.error.message);
      setDialog(null);
      router.refresh();
    });
  }

  function giveNow(sec: string) {
    setError(null);
    start(async () => {
      const res = await giveAccessNow(serviceId, sec);
      if (!res.ok) return setError(res.error.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <button type="button" onClick={() => open({ kind: "extra" })} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
            Dar un acceso extra
          </button>
        </div>
      )}
      {rows.length === 0 && pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este servicio no da acceso al portal. Se configura en Productos › variante › Portal.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Sección</th>
                <th className="px-3 py-2 font-medium">Desde</th>
                <th className="px-3 py-2 font-medium">Hasta</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Origen</th>
                {canManage && <th className="px-3 py-2 font-medium sr-only">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    {r.sectionLabel}
                    {r.otherProgram && <span className="ml-1 text-xs text-muted-foreground">(otro programa)</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.from}</td>
                  <td className="px-3 py-2 tabular-nums">{r.until}</td>
                  <td className={cn("px-3 py-2", STATE_TONE[r.state])}>{r.stateLabel}</td>
                  <td className="px-3 py-2 text-muted-foreground" title={r.reason ?? undefined}>
                    {r.sourceLabel}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {r.canExtend && (
                          <button type="button" onClick={() => open({ kind: "extend", row: r })} className="rounded-md px-2 py-1 text-xs hover:bg-accent">
                            Extender
                          </button>
                        )}
                        {r.canRevoke && (
                          <button type="button" onClick={() => open({ kind: "revoke", row: r })} className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-accent">
                            Quitar
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {pending.map((p) => (
                <tr key={`pending-${p.section}`} className="text-muted-foreground">
                  <td className="px-3 py-2">{p.sectionLabel}</td>
                  <td className="px-3 py-2" colSpan={2}>
                    Cuando llegue: {p.opensLabel.toLowerCase()}
                  </td>
                  <td className="px-3 py-2">Todavía no se abrió</td>
                  <td className="px-3 py-2">—</td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => giveNow(p.section)} disabled={pendingTx} className="rounded-md px-2 py-1 text-xs hover:bg-accent">
                        Dar ahora
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && !dialog && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {dialog && (
        <div role="dialog" aria-modal="true" aria-label="Acceso" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-background p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">
              {dialog.kind === "extra" ? "Dar un acceso extra" : dialog.kind === "extend" ? `Extender ${dialog.row.sectionLabel}` : `Quitar ${dialog.row.sectionLabel}`}
            </h3>
            {dialog.kind === "extra" && (
              <label className="block text-xs text-muted-foreground">
                Sección
                <select className={fieldInput} value={section} onChange={(e) => setSection(e.target.value)}>
                  {AVAILABLE_SECTIONS.map((s) => (
                    <option key={s} value={s}>
                      {SECTION_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {dialog.kind !== "revoke" && (
              <label className="block text-xs text-muted-foreground">
                {dialog.kind === "extra" ? "Hasta (vacío = sin fecha)" : "Hasta"}
                <input type="date" className={fieldInput} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            )}
            <label className="block text-xs text-muted-foreground">
              Motivo
              <textarea className={fieldInput} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            {dialog.kind === "revoke" && <p className="text-xs text-muted-foreground">El estudiante deja de ver esta sección. Lo que tenía queda guardado.</p>}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDialog(null)} disabled={pendingTx} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pendingTx || (dialog.kind === "extend" && !date)}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60", dialog.kind === "revoke" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground")}
              >
                {pendingTx ? "Guardando…" : dialog.kind === "revoke" ? "Quitar" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
