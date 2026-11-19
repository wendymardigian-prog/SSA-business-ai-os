"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { SaleModal } from "@/components/shared/sale-modal";
import { deleteToTrash, previewTrashDelete, restoreFromTrash } from "@/lib/actions/trash";
import { TRASH_ENTITIES, TRASH_RETENTION_DAYS, type TrashEntity } from "@/lib/trash/entities";
import type { TrashPreview } from "@/lib/trash/types";

/**
 * «Eliminar» de cualquier registro (docs/papelera.md). Primero pregunta a la base qué se va con él, qué lo frena
 * y qué avisos hay; recién con eso deja confirmar. Después ofrece «Deshacer» (lo restaura desde la Papelera).
 *
 * `redirectTo`: desde la ficha del registro, adónde ir después de eliminarlo (la ficha ya no existe).
 */
export function DeleteDialog({
  entity,
  id,
  onClose,
  onDeleted,
  redirectTo,
}: {
  entity: TrashEntity;
  id: string;
  onClose: () => void;
  onDeleted?: () => void;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<TrashPreview | null>(null);
  const [withService, setWithService] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const [pending, start] = useTransition();
  const what = TRASH_ENTITIES[entity].singular;

  useEffect(() => {
    let alive = true;
    previewTrashDelete(entity, id, { with_service: withService })
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch(() => {
        if (alive) setPreview({ ok: false, error: "No pude revisar qué se elimina. Probá de nuevo." });
      });
    return () => {
      alive = false;
    };
  }, [entity, id, withService]);

  function confirm() {
    setError(null);
    start(async () => {
      const r = await deleteToTrash(entity, id, { with_service: withService });
      if (!r.ok) return setError(r.error);
      setItemId(r.itemId);
    });
  }

  function undo() {
    if (!itemId) return;
    setError(null);
    start(async () => {
      const r = await restoreFromTrash(itemId);
      if (!r.ok) return setError(r.error);
      setUndone(true);
      router.refresh();
    });
  }

  function finish() {
    if (itemId && !undone) {
      onDeleted?.();
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    }
    onClose();
  }

  const ready = preview?.ok === true;
  const blocked = ready && preview.blockers.length > 0;

  return (
    <SaleModal
      title={itemId ? (undone ? "Listo, volvió" : "Eliminado") : `Eliminar ${what}`}
      label={`Eliminar ${what}`}
      onClose={itemId ? finish : onClose}
      footer={
        itemId ? (
          <>
            {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
            <div className="ml-auto flex gap-2">
              {!undone && (
                <button type="button" disabled={pending} onClick={undo} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">
                  {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Deshacer
                </button>
              )}
              <button type="button" onClick={finish} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Cerrar</button>
            </div>
          </>
        ) : (
          <>
            {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Volver</button>
              <button
                type="button"
                disabled={pending || !ready || blocked}
                onClick={confirm}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />} Eliminar
              </button>
            </div>
          </>
        )
      }
    >
      {itemId ? (
        <p role="status" className="text-sm">
          {undone
            ? "Se restauró tal como estaba."
            : `Está en la Papelera (Ajustes → Papelera) durante ${TRASH_RETENTION_DAYS} días. Hasta entonces se puede restaurar.`}
        </p>
      ) : !preview ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Revisando qué se elimina…
        </p>
      ) : !preview.ok ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">{preview.error}</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="font-medium break-words">{preview.label}</p>
          {preview.alsoDeleted.length > 0 && (
            <p>
              Se elimina junto con: <span className="font-medium">{preview.alsoDeleted.join(", ")}</span>.
            </p>
          )}
          {preview.offersServiceOption && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={withService}
                disabled={!preview.canDeleteService || pending}
                onChange={(e) => {
                  setPreview(null);
                  setWithService(e.target.checked);
                }}
              />
              <span>
                Eliminar también el servicio de esta venta
                {!preview.canDeleteService && <span className="block text-xs text-muted-foreground">No tenés permiso para eliminar servicios.</span>}
              </span>
            </label>
          )}
          {preview.blockers.length > 0 ? (
            <div role="alert" className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-800 dark:text-red-300">
              <p className="font-medium">No se puede eliminar:</p>
              <ul className="list-disc pl-4">
                {preview.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
              Desaparece de todas las pantallas y números. Queda {TRASH_RETENTION_DAYS} días en la Papelera, desde donde se puede restaurar.
            </p>
          )}
          {preview.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SaleModal>
  );
}

/**
 * El botón «Eliminar» con su diálogo. Quien lo pone decide si se ve (con `can("<clave>")`); el servidor y la base
 * lo vuelven a mirar igual.
 */
export function DeleteButton({
  entity,
  id,
  redirectTo,
  onDeleted,
  variant = "button",
  label = "Eliminar",
  className,
}: {
  entity: TrashEntity;
  id: string;
  redirectTo?: string;
  onDeleted?: () => void;
  variant?: "button" | "menu" | "icon";
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const base =
    variant === "menu"
      ? "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-red-700 hover:bg-red-500/10 dark:text-red-400"
      : variant === "icon"
        ? "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-400"
        : "inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-500/40 px-3 text-sm text-red-700 hover:bg-red-500/10 dark:text-red-400";
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={className ?? base}
        aria-label={variant === "icon" ? `${label} ${TRASH_ENTITIES[entity].singular}` : undefined}
        title={variant === "icon" ? label : undefined}
      >
        <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
        {variant !== "icon" && <span>{label}</span>}
      </button>
      {open && <DeleteDialog entity={entity} id={id} onClose={() => setOpen(false)} onDeleted={onDeleted} redirectTo={redirectTo} />}
    </>
  );
}
