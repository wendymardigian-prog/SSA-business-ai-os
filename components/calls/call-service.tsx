"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, Loader2, Pencil, Plus, X } from "lucide-react";
import { linkCallToService, saveManualSummary, createTaskFromCallStep } from "@/lib/actions/calls-service";
import type { ManualSummary } from "@/lib/calls/manual-summary";
import { MANUAL_NOTES_MAX, MANUAL_STEP_MAX, MANUAL_STEPS_MAX, MANUAL_SUMMARY_MAX } from "@/lib/calls/manual-summary";
import type { ServiceOption } from "@/lib/calls/service-link-options";
import { cn } from "@/lib/utils";

/**
 * El servicio de una reunión en el detalle (Servicios A4, F136) y «Cargar a mano» (F141). Solo con el módulo
 * prendido. Las reglas viven en `lib/calls/service-link-options.ts` y `lib/calls/manual-summary.ts`.
 */

export type CallServiceInfo = {
  current: { id: string; label: string; href: string } | null;
  link: string | null;
  options: ServiceOption[];
  canChange: boolean;
};

export function CallServiceChip({ callId, info }: { callId: string; info: CallServiceInfo }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const review = info.link === "review";

  const choose = (serviceId: string | null) => {
    setError(null);
    start(async () => {
      const r = await linkCallToService({ callId, serviceId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <span className="relative inline-flex items-center gap-1">
      {info.current ? (
        <Link href={info.current.href} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted">
          <Briefcase className="h-3 w-3" aria-hidden /> {info.current.label}
        </Link>
      ) : review ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          <Briefcase className="h-3 w-3" aria-hidden /> Servicio por revisar
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
          <Briefcase className="h-3 w-3" aria-hidden /> Sin servicio
        </span>
      )}
      {info.canChange && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-primary-ink hover:bg-muted max-topbar:h-10"
        >
          <Pencil className="h-3 w-3" aria-hidden /> Cambiar
        </button>
      )}
      {open && (
        <div role="dialog" aria-label="Elegir el servicio de la reunión" className="absolute left-0 top-full z-30 mt-1 w-72 rounded-md border border-border bg-popover p-1 shadow-md">
          <p className="px-2 py-1 text-[11px] text-muted-foreground">Los servicios de este contacto (los del período, primero).</p>
          <ul className="max-h-64 overflow-y-auto">
            {info.options.map((o) => (
              <li key={o.id ?? "none"}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => choose(o.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted max-topbar:min-h-10",
                    (o.id ?? null) === (info.current?.id ?? null) && "bg-muted",
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {o.covers && <span className="shrink-0 text-[11px] text-muted-foreground">en el período</span>}
                </button>
              </li>
            ))}
          </ul>
          {pending && <p className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Guardando…</p>}
          {error && <p role="alert" className="px-2 py-1 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </span>
  );
}

/** «Cargar a mano» (F141): en una reunión sin análisis. Desde cada próximo paso se puede crear una tarea (F155). */
export function ManualSummaryCard({
  callId,
  manual,
  canEdit,
  canCreateTask,
}: {
  callId: string;
  manual: ManualSummary | null;
  canEdit: boolean;
  canCreateTask: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(manual?.summary ?? "");
  const [steps, setSteps] = useState<string[]>(manual?.next_steps.length ? manual.next_steps : [""]);
  const [notes, setNotes] = useState(manual?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // F155: las tareas creadas desde cada próximo paso (índice → id), para mostrar el link en lugar del botón.
  const [created, setCreated] = useState<Record<number, string>>({});
  const createTask = (i: number, title: string) => {
    setError(null);
    start(async () => {
      const res = await createTaskFromCallStep({ callId, title });
      if (!res.ok) return setError(res.error);
      setCreated((c) => ({ ...c, [i]: res.data.taskId }));
    });
  };

  if (!manual && !editing) {
    if (!canEdit) return null;
    return (
      <div className="rounded-xl border border-dashed border-border p-3 text-sm">
        <p className="text-muted-foreground">Esta reunión no tiene análisis. Podés cargar lo que pasó a mano.</p>
        <button type="button" onClick={() => setEditing(true)} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted max-topbar:h-10">
          <Pencil className="h-3.5 w-3.5" aria-hidden /> Cargar a mano
        </button>
      </div>
    );
  }

  if (!editing && manual) {
    return (
      <section aria-label="Cargada a mano" className="space-y-2 rounded-xl border border-border p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Cargada a mano</h3>
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary-ink hover:bg-muted max-topbar:h-10">
              <Pencil className="h-3 w-3" aria-hidden /> Editar
            </button>
          )}
        </div>
        {manual.summary && <p className="whitespace-pre-wrap">{manual.summary}</p>}
        {manual.next_steps.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Próximos pasos</p>
            <ul className="mt-1 space-y-1">
              {manual.next_steps.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span>• {s}</span>
                  {canCreateTask && created[i] && (
                    <a href={`/dashboard/tareas?task=${created[i]}`} className="shrink-0 text-xs text-primary-ink hover:underline">
                      Ver la tarea
                    </a>
                  )}
                  {canCreateTask && !created[i] && (
                    <button type="button" disabled={pending} onClick={() => createTask(i, s)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary-ink hover:bg-muted disabled:opacity-50 max-topbar:h-10">
                      <Plus className="h-3 w-3" aria-hidden /> Tarea
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {manual.notes && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Notas internas</p>
            <p className="whitespace-pre-wrap">{manual.notes}</p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-bad">
            {error}
          </p>
        )}
      </section>
    );
  }

  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveManualSummary({ callId, summary, nextSteps: steps, notes });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <section aria-label="Cargar a mano" className="space-y-3 rounded-xl border border-border p-3 text-sm">
      <h3 className="text-sm font-semibold">Cargar a mano</h3>
      <label className="block">
        <span className="text-xs font-medium">Resumen</span>
        <textarea value={summary} maxLength={MANUAL_SUMMARY_MAX} onChange={(e) => setSummary(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </label>
      <div>
        <span className="text-xs font-medium">Próximos pasos</span>
        <ul className="mt-1 space-y-1">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-1">
              <input
                aria-label={`Próximo paso ${i + 1}`}
                value={s}
                maxLength={MANUAL_STEP_MAX}
                onChange={(e) => setSteps((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              />
              <button type="button" aria-label="Quitar el paso" onClick={() => setSteps((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [""]))} className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        {steps.length < MANUAL_STEPS_MAX && (
          <button type="button" onClick={() => setSteps((list) => [...list, ""])} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary-ink hover:underline">
            <Plus className="h-3 w-3" aria-hidden /> Sumar un paso
          </button>
        )}
      </div>
      <label className="block">
        <span className="text-xs font-medium">Notas internas</span>
        <textarea value={notes} maxLength={MANUAL_NOTES_MAX} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </label>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setEditing(false)} className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted max-topbar:h-10">Cancelar</button>
        <button type="button" disabled={pending} onClick={save} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 max-topbar:h-10">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
        </button>
      </div>
    </section>
  );
}
