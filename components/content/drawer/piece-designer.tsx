"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  DESIGN_BUTTON_TEXT,
  singleDesignPlatform,
  type DesignChangedNotice,
  type DesignerActions,
} from "@/lib/content/piece-designs";

/**
 * Lo del Diseñador IA en la sección «Archivos» del drawer de la pieza (DS8, F62 y F64).
 *
 * `DesignChangedNotices`: el aviso «El diseño cambió» arriba de Archivos, cuando la red está programada (o falló) y el diseño
 * es más nuevo que los archivos: «Actualizar los archivos» o «Dejar como está». `PieceDesignerBar`: «Abrir el diseño» y el
 * botón «✦ Diseñar con el Diseñador IA» (o «✦ Diseñar otra versión»); con varias redes pregunta para cuál. Lo que el
 * permiso no da no se dibuja. Qué se ve sale de `lib/content/piece-designs.ts` (puro, con su test).
 */

const smallButton =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export function DesignChangedNotices({
  notices,
  pending,
  canAct,
  onUpdate,
  onKeep,
}: {
  notices: DesignChangedNotice[];
  pending: boolean;
  /** Puede escribir la pieza y tiene `designer.edit` + `content.create`: si no, el aviso se ve sin botones (lo que el permiso no da se oculta). */
  canAct: boolean;
  onUpdate: (designId: string) => void;
  onKeep: (designId: string) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <>
      {notices.map((notice) => (
        <section
          key={notice.designId}
          aria-label={notice.title}
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2.5"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden />
          <p className="min-w-0 flex-1 text-xs">
            <b className="text-foreground">{notice.title}</b>
            {notice.name ? <span className="text-muted-foreground"> · {notice.name}</span> : null}
            <span className="block text-muted-foreground sm:inline sm:before:content-['_·_']">{notice.body}</span>
          </p>
          {canAct ? (
            <span className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={pending} onClick={() => onUpdate(notice.designId)} className={smallButton}>
                {notice.update}
              </button>
              <button type="button" disabled={pending} onClick={() => onKeep(notice.designId)} className={smallButton}>
                {notice.keep}
              </button>
            </span>
          ) : null}
        </section>
      ))}
    </>
  );
}

export function PieceDesignerBar({
  actions,
  busy,
  status,
  onDesign,
}: {
  actions: DesignerActions;
  /** Se está creando el diseño. */
  busy: boolean;
  /** Una línea de estado («Preparando los archivos…»), si hay algo en camino. */
  status: string | null;
  onDesign: (platform: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const design = actions.design;
  if (!design && actions.open.length === 0 && !status) return null;

  const single = design ? singleDesignPlatform(design) : null;
  // Las redes de los diseños de siempre, primero.
  const choices = design ? [...design.choices].sort((a, b) => Number(design.preferred.includes(b.platform)) - Number(design.preferred.includes(a.platform))) : [];

  return (
    <div className="mt-1.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {actions.open.map((open) => (
          <Link key={open.designId} href={open.href} className={smallButton}>
            {DESIGN_BUTTON_TEXT.open}
            {actions.open.length > 1 ? <span className="max-w-40 truncate text-muted-foreground"> · {open.name}</span> : null}
          </Link>
        ))}
        {design && (
          <button
            type="button"
            disabled={busy}
            aria-expanded={single ? undefined : choosing}
            onClick={() => (single ? onDesign(single) : setChoosing((v) => !v))}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {design.label}
          </button>
        )}
      </div>
      {design && choosing && !single && (
        <div role="group" aria-label={DESIGN_BUTTON_TEXT.chooseNetwork} className="rounded-lg border border-border bg-card p-2">
          <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">{DESIGN_BUTTON_TEXT.chooseNetwork}</p>
          <div className="flex flex-wrap gap-1.5">
            {choices.map((choice) => (
              <button
                key={choice.platform}
                type="button"
                disabled={busy}
                onClick={() => {
                  setChoosing(false);
                  onDesign(choice.platform);
                }}
                className={smallButton}
              >
                {choice.label}
                {choice.isNew ? <span className="text-[11px] text-muted-foreground"> (se suma a la pieza)</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
      {status && (
        <p role="status" className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {status}
        </p>
      )}
    </div>
  );
}
