// @plantilla-quitar(servicios)
"use client";

/**
 * «Reparto de clientes» (Servicios A4, F151): el tope de servicios a cargo de cada persona, con «N de M». El reparto
 * automático saltea a quien llegó a su tope; si todos llegaron, va al respaldo de la variante y avisa a Owner y Admin.
 * Asignar a mano no se frena (solo avisa «Supera su tope»).
 */
import { useEffect, useState, useTransition } from "react";
import { Loader2, Users } from "lucide-react";
import { loadServiceCapacity, saveServiceCapacity, type CapacityView } from "@/lib/actions/service-capacity";
import { SidePanel } from "@/components/tasks/overlay";
import { cn } from "@/lib/utils";

export function CapacityButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
        <Users className="h-4 w-4" aria-hidden />
        Reparto de clientes
      </button>
      {open && <CapacityPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function CapacityPanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<CapacityView | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() {
    start(async () => {
      const res = await loadServiceCapacity();
      if (!res.ok) return setError(res.error.message);
      setView(res.data);
      setValues(Object.fromEntries(res.data.rows.map((r) => [r.id, r.cap ? String(r.cap) : ""])));
    });
  }
  useEffect(load, []);

  function save() {
    if (!view) return;
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await saveServiceCapacity(values, view.rev);
      if (!res.ok) return setError(res.error.message);
      if (res.data.status === "conflict") return setError("Alguien cambió los topes mientras los editabas. Volvé a abrir el panel para ver lo último.");
      setNotice("Guardado. Vale para los próximos servicios que se repartan.");
      load();
    });
  }

  return (
    <SidePanel
      label="Reparto de clientes"
      onClose={onClose}
      header={<p className="text-sm font-semibold">Reparto de clientes</p>}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            Cerrar
          </button>
          <button type="button" disabled={pending || !view} onClick={save} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Guardar
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-4 text-sm">
        <p className="text-muted-foreground">
          Cuántos clientes puede tener a cargo cada persona (activos, pausados o por confirmar, de todos los productos). El reparto automático saltea a quien llegó a su tope. Vacío = sin tope.
        </p>
        {!view && pending && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />}
        {view && view.rows.length === 0 && <p className="text-muted-foreground">Todavía no hay nadie en el equipo.</p>}
        {view && view.rows.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {view.rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className={cn("block text-xs", r.full ? "text-warn" : "text-muted-foreground")}>
                    {r.label} {r.full ? "· llegó a su tope" : "a cargo"}
                  </span>
                </span>
                <label className="sr-only" htmlFor={`cap-${r.id}`}>
                  Tope de {r.name}
                </label>
                <input
                  id={`cap-${r.id}`}
                  inputMode="numeric"
                  placeholder="Sin tope"
                  value={values[r.id] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                  className="h-9 w-24 rounded-lg border border-border bg-background px-3 text-sm"
                />
              </li>
            ))}
          </ul>
        )}
        {notice && <p className="text-xs text-good">{notice}</p>}
        {error && (
          <p role="alert" className="text-xs text-bad">
            {error}
          </p>
        )}
      </div>
    </SidePanel>
  );
}
