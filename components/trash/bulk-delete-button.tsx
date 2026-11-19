"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { SaleModal } from "@/components/shared/sale-modal";
import { deleteManyToTrash } from "@/lib/actions/trash";
import { bulkCountLabel, bulkDeleteSummary, type BulkNoun } from "@/lib/trash/bulk-summary";
import { TRASH_RETENTION_DAYS, type TrashEntity } from "@/lib/trash/entities";

/** El tope de `deleteManyToTrash`: más que eso por vez no se manda. */
const MAX_PER_CALL = 100;

/**
 * «Eliminar seleccionadas» de una tabla con selección (Ventas, Pagos). Confirma en un modal, elimina de a una en el
 * servidor (cada una con sus reglas: lo que no se puede, no se elimina) y muestra el resumen. Quien lo pone decide si se
 * ve (con la clave de eliminar); el servidor la vuelve a mirar.
 */
export function BulkDeleteButton({
  entity,
  ids,
  noun,
  onDone,
}: {
  entity: TrashEntity;
  ids: readonly string[];
  noun: BulkNoun;
  /** Después de cerrar el resumen (por ejemplo, soltar la selección). */
  onDone: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const count = Math.min(ids.length, MAX_PER_CALL);
  const what = bulkCountLabel(count, noun);

  function confirm() {
    setError(null);
    start(async () => {
      const r = await deleteManyToTrash(entity, ids.slice(0, MAX_PER_CALL));
      if (!r.ok) return setError(r.error);
      setSummary(bulkDeleteSummary(r.deleted, r.failures, noun));
      router.refresh();
    });
  }

  function close() {
    if (pending) return;
    const finished = summary !== null;
    setOpen(false);
    setSummary(null);
    setError(null);
    if (finished) onDone();
  }

  if (ids.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-500/40 px-2.5 text-sm text-red-700 hover:bg-red-500/10 dark:text-red-400"
        aria-label={`Eliminar ${bulkCountLabel(ids.length, noun)} seleccionad${noun.feminine ? "a" : "o"}${ids.length === 1 ? "" : "s"}`}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Eliminar seleccionad{noun.feminine ? "a" : "o"}s</span>
        <span className="rounded-full bg-red-500/10 px-1.5 text-[11px] tabular-nums">{ids.length}</span>
      </button>
      {open && (
        <SaleModal
          title={summary ? "Listo" : `Eliminar ${what}`}
          label={`Eliminar ${what}`}
          onClose={close}
          footer={
            <>
              {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
              <div className="ml-auto flex gap-2">
                {summary ? (
                  <button type="button" onClick={close} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Cerrar</button>
                ) : (
                  <>
                    <button type="button" disabled={pending} onClick={close} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">Volver</button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={confirm}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />} Eliminar
                    </button>
                  </>
                )}
              </div>
            </>
          }
        >
          {summary ? (
            <div className="space-y-2 text-sm" role="status">
              <p className="break-words">{summary}.</p>
              <p className="text-xs text-muted-foreground">Lo eliminado queda {TRASH_RETENTION_DAYS} días en la Papelera (Ajustes → Papelera), desde donde se puede restaurar.</p>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p>
                Vas a eliminar <span className="font-medium">{what}</span>. {noun.feminine ? "Cada una se revisa por separado: si alguna no se puede eliminar" : "Cada uno se revisa por separado: si alguno no se puede eliminar"}, queda como está y te digo por qué.
              </p>
              {ids.length > MAX_PER_CALL && (
                <p className="text-xs text-amber-800 dark:text-amber-300">Se eliminan de a {MAX_PER_CALL} por vez: elegiste {ids.length}, van las primeras {MAX_PER_CALL}.</p>
              )}
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                Desaparecen de todas las pantallas y números, junto con lo que depende de {noun.feminine ? "cada una" : "cada uno"}. Quedan {TRASH_RETENTION_DAYS} días en la Papelera, desde donde se pueden restaurar.
              </p>
            </div>
          )}
        </SaleModal>
      )}
    </>
  );
}
