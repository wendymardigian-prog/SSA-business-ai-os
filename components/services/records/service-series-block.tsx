"use client";
// @plantilla-quitar(servicios)

/**
 * «Pasos que se repiten» en la ficha del servicio (00522): cada serie con su regla, las vueltas que hubo y la próxima.
 * Con `services.items`: «Cambiar» (cada cuánto y hasta cuándo, solo en este servicio) y «Terminar serie».
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Repeat } from "lucide-react";
import { changeItemSeries, endItemSeries } from "@/lib/actions/service-series";
import type { SeriesView } from "@/lib/services/screens/series-view";
import type { JourneyItem } from "@/lib/services/journey-template";
import type { NamedOption } from "@/components/services/products/service-settings-panel";
import { RepeatSection } from "@/components/services/products/challenge-sections";
import { ActionError } from "@/components/contacts/ui";
import { SidePanel } from "@/components/tasks/overlay";

const civilShort = new Intl.DateTimeFormat("es", { timeZone: "UTC", day: "numeric", month: "short" });
const fmt = (d: string | null) => (d ? civilShort.format(new Date(`${d}T12:00:00Z`)) : "—");

export function ServiceSeriesBlock({
  series,
  canEdit,
  phaseOptions,
  itemOptions,
  phaseKeys,
}: {
  series: SeriesView[];
  canEdit: boolean;
  /** Las fases y pasos del servicio por su clave, para «desde» y «hasta» en «Cambiar». */
  phaseOptions: NamedOption[];
  itemOptions: NamedOption[];
  /** La clave de la fase de cada serie (por id de fase). */
  phaseKeys: Record<string, string>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<SeriesView | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [ending, setEnding] = useState<SeriesView | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (series.length === 0) return null;

  function save() {
    if (!editing || !draft) return;
    setError(null);
    start(async () => {
      const r = await changeItemSeries(editing.id, draft);
      if (!r.ok) return setError(r.error.message);
      setEditing(null);
      router.refresh();
    });
  }
  function end() {
    if (!ending) return;
    setError(null);
    start(async () => {
      const r = await endItemSeries(ending.id, note);
      if (!r.ok) return setError(r.error.message);
      setEnding(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="record-series" className="space-y-2 rounded-xl border border-border p-3">
      <h3 id="record-series" className="flex items-center gap-1.5 text-sm font-semibold">
        <Repeat className="h-4 w-4 text-muted-foreground" aria-hidden /> Pasos que se repiten
      </h3>
      <ul className="divide-y divide-border">
        {series.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.name}</p>
              <p className="text-xs text-muted-foreground">{s.rule}</p>
              <p className="text-xs text-muted-foreground">
                {s.rounds === 0 ? "Todavía no tuvo vueltas" : `${s.rounds} ${s.rounds === 1 ? "vuelta" : "vueltas"} · ${s.done} cumplidas · la última el ${fmt(s.lastOn)}`}
                {s.nextOn ? ` · la próxima el ${fmt(s.nextOn)}` : ""}
              </p>
            </div>
            {s.ended ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{s.endedLabel}</span>
            ) : canEdit ? (
              <span className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setDraft(s.recurrence);
                    setEditing(s);
                  }}
                  className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 text-xs hover:bg-accent md:min-h-8"
                >
                  Cambiar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setEnding(s);
                  }}
                  className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 text-xs text-bad hover:bg-accent md:min-h-8"
                >
                  Terminar serie
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {editing && (
        <SidePanel label={`Cambiar «${editing.name}»`} header={<h2 className="text-base font-semibold">Cambiar «{editing.name}»</h2>} onClose={() => setEditing(null)}>
          <div className="space-y-3 p-4">
            <p className="text-xs text-muted-foreground">Cambia solo en este servicio. Las vueltas que ya hubo quedan como están; las que vienen siguen la regla nueva.</p>
            <RepeatSection
              item={{ key: editing.id, kind: "team_task", name: editing.name, recurrence: draft } as unknown as JourneyItem}
              phases={phaseOptions}
              items={itemOptions}
              ownPhaseKey={phaseKeys[editing.phaseId] ?? ""}
              onChange={(patch) => {
                // Destildar «Se repite» acá no termina la serie (para eso está «Terminar serie»).
                if (patch.recurrence) setDraft(patch.recurrence as Record<string, unknown>);
              }}
            />
            {error && <ActionError message={error} />}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="h-10 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent md:h-9">
                Cancelar
              </button>
              <button type="button" disabled={pending || !draft} onClick={save} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 md:h-9">
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                Guardar
              </button>
            </div>
          </div>
        </SidePanel>
      )}

      {ending && (
        <SidePanel label={`Terminar «${ending.name}»`} header={<h2 className="text-base font-semibold">Terminar «{ending.name}»</h2>} onClose={() => setEnding(null)}>
          <div className="space-y-3 p-4">
            <p className="text-sm">No se van a crear más vueltas de este paso en este servicio. Las que ya existen quedan como están. No se puede deshacer.</p>
            <label className="block text-xs font-semibold">
              Motivo (opcional)
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal" />
            </label>
            {error && <ActionError message={error} />}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEnding(null)} className="h-10 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent md:h-9">
                Cancelar
              </button>
              <button type="button" disabled={pending} onClick={end} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-bad px-3 text-sm font-medium text-white disabled:opacity-50 md:h-9">
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                Terminar serie
              </button>
            </div>
          </div>
        </SidePanel>
      )}
    </section>
  );
}
