"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Loader2, Pencil, Plus, RotateCcw } from "lucide-react";
import { saveExpenseCategories } from "@/lib/actions/finance-categories";
import { SaleModal } from "@/components/sales/sale-modal";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { CATEGORY_COLORS, CATEGORY_GROUPS, CATEGORY_GROUP_HINTS, CATEGORY_GROUP_LABELS, CATEGORY_NAME_MAX, type ExpenseCategory } from "@/lib/finance/categories";
import {
  CATEGORY_COLOR_NAMES, EMPTY_CATEGORY_DRAFT, NO_USAGE, canArchiveCategory, categoryDraftError, categorySections, draftFromCategory, itemsWithArchived, itemsWithDraft,
  type CategoryDraft, type CategoryUsage,
} from "@/lib/finance/category-totals";
import { formatUsd } from "@/lib/finance/format";

/**
 * Las categorías de gasto (Ajustes > General > Finanzas): agrupadas por grupo, con cuántos gastos tiene cada una y
 * cuánto se pagó en el año. Una categoría no se borra: se archiva (los gastos viejos la siguen mostrando). Las del
 * sistema se renombran, se recolorean y cambian de grupo, pero no se archivan: los gastos automáticos las usan.
 * Cambiar el grupo de una categoría reclasifica TAMBIÉN los gastos ya pagados en el panel.
 */
export function FinanceCategoriesCard({
  categories,
  usage,
  usageFailed,
  usageTruncated,
}: {
  categories: ExpenseCategory[];
  usage: Record<string, CategoryUsage>;
  usageFailed: boolean;
  usageTruncated: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sections = categorySections(categories);

  function run(items: Parameters<typeof saveExpenseCategories>[0], onOk?: () => void) {
    start(async () => {
      const result = await saveExpenseCategories(items);
      if (!result.ok) {
        if (onOk) setFormError(result.error);
        else setError(result.error);
        return;
      }
      setError(null);
      setFormError(null);
      onOk?.();
      router.refresh();
    });
  }

  function save() {
    if (!draft) return;
    const invalid = categoryDraftError(draft, categories);
    if (invalid) return setFormError(invalid);
    run(itemsWithDraft(categories, draft), () => setDraft(null));
  }

  return (
    <fieldset className="mt-4">
      <div className="flex items-center gap-2">
        <legend className="text-xs font-medium text-muted-foreground">Categorías de gasto</legend>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setDraft({ ...EMPTY_CATEGORY_DRAFT });
          }}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Categoría
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Ordenan los gastos y el panel de Finanzas. Una categoría no se borra: se archiva, y los gastos que ya la tienen la siguen mostrando. Las marcadas «Del sistema» las usan los gastos automáticos: se pueden renombrar, pero no archivar.
      </p>
      {usageFailed && <p role="alert" className="mt-2 text-xs text-amber-700 dark:text-amber-300">No pudimos contar los gastos de cada categoría. Recargá la página para volver a intentarlo.</p>}
      {usageTruncated && <p className="mt-2 text-[11px] text-muted-foreground">Hay muchísimos gastos: los números cuentan los primeros 20.000.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">{error}</p>}

      <div className="mt-3 space-y-5">
        {sections.map((section) => (
          <section key={section.group} aria-labelledby={`cat-group-${section.group}`}>
            <h3 id={`cat-group-${section.group}`} className="text-sm font-semibold">{section.label}</h3>
            <p className="text-[11px] text-muted-foreground">{section.hint}</p>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">Categorías del grupo {section.label}</caption>
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Categoría</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Gastos</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Pagado este año</th>
                    <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                    <th scope="col" className="w-24 px-3 py-2"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((c) => {
                    const u = usage[c.key] ?? NO_USAGE;
                    return (
                      <tr key={c.key} className={`border-t border-border ${c.archived_at ? "text-muted-foreground" : ""}`}>
                        <td className="px-3 py-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
                            <span className="min-w-0 truncate font-medium">{c.name}</span>
                            {c.system && <span title="La usan los gastos automáticos" className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Del sistema</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{u.count}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatUsd(u.paidYearCents)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.archived_at ? "bg-zinc-500/12 text-zinc-600 dark:text-zinc-300" : "bg-green-500/12 text-green-600 dark:text-green-300"}`}>
                            {c.archived_at ? "Archivada" : "Activa"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              aria-label={`Editar ${c.name}`}
                              onClick={() => {
                                setFormError(null);
                                setDraft(draftFromCategory(c));
                              }}
                              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            {c.archived_at ? (
                              <button type="button" aria-label={`Restaurar ${c.name}`} disabled={pending} onClick={() => run(itemsWithArchived(categories, c.key, false))} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50">
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            ) : canArchiveCategory(c) ? (
                              <button type="button" aria-label={`Archivar ${c.name}`} disabled={pending} onClick={() => run(itemsWithArchived(categories, c.key, true))} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50">
                                <Archive className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {draft && (
        <SaleModal
          title={draft.key ? "Editar categoría" : "Nueva categoría"}
          label={draft.key ? "Editar categoría" : "Nueva categoría"}
          onClose={() => setDraft(null)}
          footer={
            <>
              {formError && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{formError}</p>}
              <button type="button" onClick={() => setDraft(null)} className="ml-auto h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
              <button type="button" disabled={pending} onClick={save} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Guardar
              </button>
            </>
          }
        >
          <DialogField label="Nombre">
            <input className={fieldInput} maxLength={CATEGORY_NAME_MAX} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ej.: Viajes y hoteles" />
          </DialogField>
          <DialogField label="Grupo" hint={`${CATEGORY_GROUP_LABELS[draft.group]}: ${CATEGORY_GROUP_HINTS[draft.group]} Cambiarlo reclasifica también los gastos ya pagados en el panel.`}>
            <select className={fieldInput} value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value as CategoryDraft["group"] })}>
              {CATEGORY_GROUPS.map((g) => <option key={g} value={g}>{CATEGORY_GROUP_LABELS[g]}</option>)}
            </select>
          </DialogField>
          <fieldset>
            <legend className="text-xs font-medium">Color</legend>
            <div role="radiogroup" aria-label="Color de la categoría" className="mt-2 flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((color) => {
                const selected = draft.color.toLowerCase() === color;
                return (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={CATEGORY_COLOR_NAMES[color]}
                    title={CATEGORY_COLOR_NAMES[color]}
                    onClick={() => setDraft({ ...draft, color })}
                    className={`grid h-8 w-8 place-items-center rounded-full ring-offset-2 ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "ring-2 ring-foreground" : ""}`}
                    style={{ backgroundColor: color }}
                  >
                    {selected && <Check className="h-4 w-4 text-white" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </SaleModal>
      )}
    </fieldset>
  );
}
