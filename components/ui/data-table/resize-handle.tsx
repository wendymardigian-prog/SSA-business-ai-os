"use client";

import { useRef } from "react";
import { clampWidth, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from "@/lib/ui/data-table/prefs";

/**
 * El borde del encabezado que se arrastra para cambiar el ancho de una columna. Es el mismo en todas las tablas del
 * sistema (salió de la lista de Agenda): arrastre con el mouse, flechas ←/→ (Shift = pasos grandes), Home y doble clic
 * para volver al ancho normal.
 */
export function ResizeHandle({
  label,
  width,
  onLive,
  onCommit,
  onReset,
}: {
  label: string;
  width: number;
  /** Mientras se arrastra (null = se canceló). */
  onLive: (px: number | null) => void;
  onCommit: (px: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);

  function end(event: React.PointerEvent<HTMLSpanElement>, commit: boolean) {
    const start = drag.current;
    if (!start) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (commit) onCommit(clampWidth(start.width + event.clientX - start.x));
    else onLive(null);
  }

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Ajustar el ancho de ${label}`}
      aria-valuenow={width}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      tabIndex={0}
      title="Arrastrá para ajustar el ancho. Doble clic: ancho normal."
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start) onLive(clampWidth(start.width + event.clientX - start.x));
      }}
      onPointerUp={(event) => end(event, true)}
      onPointerCancel={(event) => end(event, false)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        if (event.key === "ArrowRight") onCommit(clampWidth(width + step));
        else if (event.key === "ArrowLeft") onCommit(clampWidth(width - step));
        else if (event.key === "Home") onReset();
        else return;
        event.preventDefault();
      }}
      className="group/resize absolute inset-y-0 -right-1 z-20 flex w-2 cursor-col-resize touch-none select-none justify-center focus-visible:outline-none"
    >
      <span className="h-full w-px bg-transparent group-hover/resize:bg-primary-edge group-focus-visible/resize:bg-primary-edge group-active/resize:w-0.5 group-active/resize:bg-primary-edge" />
    </span>
  );
}
