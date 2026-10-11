"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Trash2 } from "lucide-react";
import { createVersionDraft, deleteVersionDraft, publishVersion, updateVersionDraft } from "@/lib/actions/products";
import { formatMoney } from "@/lib/sales/format";
import { formatAmount } from "@/lib/sales/format";
import { newVersionDraftFrom, priceHistory, type HistoryVersion } from "@/lib/sales/catalog/price-history";
import { PLACEHOLDER_NOTE, resolveActiveVersion } from "@/lib/sales/catalog/versions";
import { ActionError } from "@/components/contacts/ui";
import { fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  draft: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  deprecated: "bg-muted text-muted-foreground",
};

function formatDate(value: string | null, timeZone: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-AR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * La pestaña "Precio" de una variante (plano F5 y F6): la versión vigente, el
 * borrador (si hay) y el historial de precios. Una versión publicada no se
 * edita: «Nueva versión» arranca de una copia de la activa.
 */
export function VariantPriceTab({
  versions,
  salesByVersion,
  userNames,
  variantId,
  timeZone,
}: {
  versions: HistoryVersion[];
  salesByVersion: Record<string, number>;
  userNames: Record<string, string>;
  variantId: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const active = resolveActiveVersion(versions);
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const history = priceHistory(versions, salesByVersion, userNames);

  function run(task: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function newVersion() {
    const base = newVersionDraftFrom(versions);
    run(() => createVersionDraft({ variantId, priceUsd: base?.price ?? 0, changeNotes: base && base.price > 0 ? null : PLACEHOLDER_NOTE }));
  }

  return (
    <div className="space-y-5">
      {error && <ActionError message={error} />}

      <div className="rounded-lg border border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">Precio vigente</p>
        {active ? (
          <p className="mt-1 text-lg font-semibold">
            {formatMoney(active.price)} <span className="text-xs font-normal text-muted-foreground">· versión {active.version_number}</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
            Esta variante no tiene un precio publicado: no se puede vender hasta que publiques una versión.
          </p>
        )}
      </div>

      {draft ? (
        <DraftEditor key={draft.id} draft={draft} pending={pending} run={run} />
      ) : (
        <button
          type="button"
          onClick={newVersion}
          disabled={pending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Nueva versión
        </button>
      )}

      <div>
        <h4 className="text-sm font-semibold">Historial de precios</h4>
        {history.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Todavía no hay versiones.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Versión</th>
                  <th className="px-3 py-2 font-medium">Precio</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Publicó</th>
                  <th className="px-3 py-2 font-medium">Ventas</th>
                  <th className="px-3 py-2 font-medium">Notas</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-medium">v{row.number}</td>
                    <td className="px-3 py-2">{row.priceLabel}</td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[row.status] ?? STATUS_STYLE.deprecated)}>{row.statusLabel}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.publishedAt ? `${formatDate(row.publishedAt, timeZone)}${row.publishedBy ? ` · ${row.publishedBy}` : ""}` : "—"}
                    </td>
                    <td className="px-3 py-2">{row.sales}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2 text-muted-foreground" title={row.notes}>
                      {row.notes || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {row.canDelete && (
                        <button
                          type="button"
                          aria-label={`Borrar el borrador de la versión ${row.number}`}
                          onClick={() => run(() => deleteVersionDraft(row.id))}
                          disabled={pending}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DraftEditor({
  draft,
  pending,
  run,
}: {
  draft: HistoryVersion;
  pending: boolean;
  run: (task: () => Promise<{ ok: true } | { ok: false; error: string }>) => void;
}) {
  const placeholder = (draft.change_notes ?? "").trim() === PLACEHOLDER_NOTE && Number(draft.price) === 0;
  const [price, setPrice] = useState(placeholder ? "" : formatAmount(draft.price));
  const [notes, setNotes] = useState(placeholder ? "" : (draft.change_notes ?? ""));

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">Borrador · versión {draft.version_number}</p>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Precio en USD</span>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="1497" className={fieldInput} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Notas del cambio</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Qué cambió y por qué" className={fieldInput} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => updateVersionDraft({ id: draft.id, priceUsd: price, changeNotes: notes }))}
          className="h-9 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          Guardar borrador
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const saved = await updateVersionDraft({ id: draft.id, priceUsd: price, changeNotes: notes });
              if (!saved.ok) return saved;
              return publishVersion(draft.id);
            })
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          Publicar
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">Al publicar, la versión vigente queda reemplazada. Lo ya vendido conserva el precio con el que se vendió.</p>
    </div>
  );
}
