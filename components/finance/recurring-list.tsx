"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, Pause, Pencil, Play, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { FinanceTabs, ReadOnlyNote } from "@/components/finance/finance-tabs";
import { RecurringFormDialog } from "@/components/finance/recurring-form-dialog";
import { SaleModal } from "@/components/shared/sale-modal";
import { setRecurringActive } from "@/lib/actions/finance-recurring";
import { ESTADO_FILTERS, ESTADO_LABELS, estadoHref, type RecurringListItem, type RecurringScreenData } from "@/lib/finance/recurring-list";
import { emptyRecurringDraft, type RecurringDraft } from "@/lib/finance/recurring-form";
import { formatCivilDate } from "@/lib/finance/view";

/**
 * Finanzas > Recurrentes. Las plantillas de los gastos que se repiten: cada una crea sola sus gastos en la fecha que
 * le toca (el trabajo diario). Una plantilla no se borra: se pausa. Pausar no toca los gastos ya creados; al
 * reactivar, las fechas que cayeron en el medio NO se crean solas y se avisa cuáles fueron. Sin `expenses.manage`,
 * la pantalla es de solo lectura.
 */
const STATUS_CLASSES: Record<RecurringListItem["status"], string> = {
  active: "bg-green-500/12 text-green-700 dark:text-green-300",
  paused: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  finished: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-300",
};

type Notice = { kind: "info" | "missed"; text: string; dates?: string[] };

export function RecurringList({ data }: { data: RecurringScreenData }) {
  const { items, estado, counts, summary, categories, vendors, members, today, canManage, loadError, truncated } = data;
  const router = useRouter();
  const [draft, setDraft] = useState<RecurringDraft | null>(null);
  const [confirmPause, setConfirmPause] = useState<RecurringListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, start] = useTransition();

  function openNew() {
    setDraft(emptyRecurringDraft(today, categories));
  }

  function toggle(item: RecurringListItem, active: boolean) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await setRecurringActive(item.id, active);
      setConfirmPause(null);
      if (!result.ok) return setError(result.error);
      if (active) {
        const missed = result.missedDates;
        setNotice(
          missed.length > 0
            ? {
                kind: "missed",
                dates: missed,
                text: `Mientras estuvo pausada cayeron ${missed.length} ${missed.length === 1 ? "fecha de pago que no se creó sola" : "fechas de pago que no se crearon solas"}: ${missed.map(formatCivilDate).join(", ")}. Si querés registrarlas, cargalas a mano desde Gastos.`,
              }
            : { kind: "info", text: `«${item.concept}» volvió a estar activa. No cayó ninguna fecha de pago mientras estuvo pausada.` },
        );
      } else {
        setNotice({ kind: "info", text: `«${item.concept}» quedó pausada: no crea gastos nuevos. Los que ya se crearon no cambian.` });
      }
      router.refresh();
    });
  }

  const addButton = canManage ? (
    <button type="button" onClick={openNew} aria-label="Nueva plantilla" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
      <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Nueva plantilla</span>
    </button>
  ) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/finanzas/recurrentes" tabs={<FinanceTabs />} right={addButton} />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="space-y-4">
          {!canManage && <ReadOnlyNote />}

          {loadError ? (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm">
              <p className="text-red-700 dark:text-red-300">No pudimos cargar los gastos recurrentes.</p>
              <button type="button" onClick={() => router.refresh()} className="mt-3 h-8 rounded-lg border border-border px-3 hover:bg-accent">Reintentar</button>
            </div>
          ) : counts.todas === 0 ? (
            <div className="rounded-xl border border-border p-8 text-center text-sm">
              <CalendarClock className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="font-medium">Todavía no hay gastos recurrentes</p>
              <p className="mx-auto mt-1 max-w-md text-muted-foreground">
                Cargá lo que pagás todos los meses (suscripciones, sueldos, alquiler) una sola vez y el sistema crea el gasto solo en cada fecha de pago.
              </p>
              {canManage && (
                <button type="button" onClick={openNew} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
                  <Plus className="h-4 w-4" aria-hidden /> Nueva plantilla
                </button>
              )}
            </div>
          ) : (
            <>
              <section aria-label="Resumen" className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">Gastos recurrentes activos ({summary.activeCount})</p>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums">{summary.headline}</p>
                {summary.note && <p className="mt-1 text-xs text-muted-foreground">{summary.note}</p>}
              </section>

              {notice && (
                <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${notice.kind === "missed" ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" : "border-border bg-muted/40"}`}>
                  <p>{notice.text}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    {notice.kind === "missed" && <Link href="/dashboard/finanzas/gastos" className="text-sm font-medium underline-offset-2 hover:underline">Ir a Gastos</Link>}
                    <button type="button" onClick={() => setNotice(null)} className="text-xs underline-offset-2 hover:underline">Cerrar aviso</button>
                  </div>
                </div>
              )}

              <nav aria-label="Estado de las plantillas" className="flex flex-wrap items-center gap-2">
                {ESTADO_FILTERS.map((f) => (
                  <Link
                    key={f}
                    href={estadoHref(f)}
                    aria-current={estado === f ? "page" : undefined}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm ${estado === f ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-accent"}`}
                  >
                    {ESTADO_LABELS[f]}
                    <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{counts[f]}</span>
                  </Link>
                ))}
                {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
              </nav>

              {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
              {truncated && <p className="text-[11px] text-muted-foreground">Hay muchísimas plantillas: se muestran las primeras 500.</p>}

              {items.length === 0 ? (
                <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
                  No hay plantillas {estado === "activas" ? "activas" : estado === "pausadas" ? "pausadas" : "terminadas"}.
                  {estado !== "todas" && <Link href={estadoHref("todas")} className="ml-2 underline">Ver todas</Link>}
                </div>
              ) : (
                <>
                  <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                    <table className="w-full min-w-[980px] text-sm">
                      <caption className="sr-only">Plantillas de gastos recurrentes</caption>
                      <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                        <tr>
                          {["Concepto", "Estado", "Frecuencia", "Monto", "Por mes", "Próximo pago", "Cobro", "Responsable", ""].map((h, i) => (
                            <th key={i} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium ${i === 3 || i === 4 ? "text-right" : ""}`}>{h || <span className="sr-only">Acciones</span>}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {items.map((item) => (
                          <tr key={item.id} className="align-top hover:bg-muted/30">
                            <td className="max-w-[260px] px-3 py-2"><ConceptCell item={item} /></td>
                            <td className="px-3 py-2"><StatusChip item={item} /></td>
                            <td className="px-3 py-2 text-muted-foreground">{item.frequencyText}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{item.amountLabel}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{item.monthlyLabel}</td>
                            <td className="whitespace-nowrap px-3 py-2">{nextLabel(item)}</td>
                            <td className="px-3 py-2 text-muted-foreground">{item.chargeLabel}</td>
                            <td className="max-w-[160px] truncate px-3 py-2 text-muted-foreground">{item.responsibleName ?? "—"}</td>
                            <td className="px-3 py-2">
                              <RowActions item={item} canManage={canManage} disabled={pending} onEdit={() => setDraft(item.draft)} onPause={() => setConfirmPause(item)} onResume={() => toggle(item, true)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <ul className="space-y-2 md:hidden">
                    {items.map((item) => (
                      <li key={item.id} className="rounded-xl border border-border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <ConceptCell item={item} />
                          <StatusChip item={item} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{item.frequencyText} · {item.chargeLabel}</p>
                        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                          <div><dt className="text-muted-foreground">Monto</dt><dd className="font-medium tabular-nums">{item.amountLabel}</dd></div>
                          <div><dt className="text-muted-foreground">Por mes</dt><dd className="font-medium tabular-nums">{item.monthlyLabel}</dd></div>
                          <div><dt className="text-muted-foreground">Próximo pago</dt><dd className="font-medium">{nextLabel(item)}</dd></div>
                        </dl>
                        {item.responsibleName && <p className="mt-1 text-xs text-muted-foreground">Responsable: {item.responsibleName}</p>}
                        <div className="mt-2"><RowActions item={item} canManage={canManage} disabled={pending} onEdit={() => setDraft(item.draft)} onPause={() => setConfirmPause(item)} onResume={() => toggle(item, true)} /></div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {draft && (
        <RecurringFormDialog
          key={draft.id ?? "new"}
          initial={draft}
          categories={categories}
          vendors={vendors}
          members={members}
          today={today}
          onClose={() => setDraft(null)}
        />
      )}

      {confirmPause && (
        <SaleModal
          title="Pausar gasto recurrente"
          label="Pausar gasto recurrente"
          onClose={() => setConfirmPause(null)}
          footer={
            <>
              <button type="button" onClick={() => setConfirmPause(null)} className="ml-auto h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
              <button type="button" disabled={pending} onClick={() => toggle(confirmPause, false)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Pausar
              </button>
            </>
          }
        >
          <p className="text-sm">¿Pausás <strong>{confirmPause.concept}</strong>?</p>
          <p className="text-sm text-muted-foreground">Mientras esté pausada no crea gastos nuevos. Los que ya se crearon no cambian. Cuando la reactives, las fechas que caigan en el medio no se crean solas: te avisamos cuáles fueron.</p>
        </SaleModal>
      )}
    </div>
  );
}

function nextLabel(item: RecurringListItem): string {
  if (item.status === "paused") return "Pausada";
  if (item.status === "finished") return item.endDate ? `Terminó (${formatCivilDate(item.endDate)})` : "Terminada";
  return formatCivilDate(item.nextDate);
}

function ConceptCell({ item }: { item: RecurringListItem }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{item.concept}</p>
      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.categoryColor }} aria-hidden />
        <span className="truncate">{item.categoryName} · {item.vendorName}</span>
      </p>
    </div>
  );
}

function StatusChip({ item }: { item: RecurringListItem }) {
  return <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[item.status]}`}>{item.statusLabel}</span>;
}

function RowActions({
  item, canManage, disabled, onEdit, onPause, onResume,
}: {
  item: RecurringListItem;
  canManage: boolean;
  disabled: boolean;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  if (!canManage) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap">
      <button type="button" onClick={onEdit} disabled={disabled} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
        <Pencil className="h-3.5 w-3.5" aria-hidden /> Editar<span className="sr-only"> {item.concept}</span>
      </button>
      {item.status === "paused" ? (
        <button type="button" onClick={onResume} disabled={disabled} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
          <Play className="h-3.5 w-3.5" aria-hidden /> Reactivar<span className="sr-only"> {item.concept}</span>
        </button>
      ) : item.status === "active" ? (
        <button type="button" onClick={onPause} disabled={disabled} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
          <Pause className="h-3.5 w-3.5" aria-hidden /> Pausar<span className="sr-only"> {item.concept}</span>
        </button>
      ) : null}
    </div>
  );
}
