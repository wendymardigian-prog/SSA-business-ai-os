"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { TagChip } from "@/components/contacts/ui";
import { fitCount } from "@/lib/ui/fit-chips";

/**
 * Las etiquetas de un contacto en UNA línea (la tabla de Contactos): las que entran según el ancho de la columna y al
 * final un globito «+N» con las que no se ven (sus nombres, al pasar el mouse). Mide los chips en una fila invisible y
 * recalcula cuando cambia el ancho (`ResizeObserver`), así ensanchar la columna muestra más. Antes de medir, o sin
 * `ResizeObserver`, se ven todas en una línea cortada.
 */

const GAP = 4; // `gap-1`

type Tag = { id: string; name: string; color: string | null };

export function TagChipsFit({ tags }: { tags: readonly Tag[] }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState<number | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const measure = measureRef.current;
    if (!box || !measure || typeof ResizeObserver === "undefined") return;
    const compute = () => {
      const nodes = Array.from(measure.children) as HTMLElement[];
      const plus = nodes.pop();
      const widths = nodes.map((n) => n.getBoundingClientRect().width);
      const plusWidth = plus?.getBoundingClientRect().width ?? 0;
      const available = box.getBoundingClientRect().width;
      if (available <= 0) return;
      setVisible(fitCount(widths, available, GAP, plusWidth));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(box);
    return () => observer.disconnect();
  }, [tags]);

  if (tags.length === 0) return <span className="text-sm text-muted-foreground">—</span>;

  const shown = visible === null ? tags : tags.slice(0, visible);
  const hidden = visible === null ? [] : tags.slice(visible);
  const hiddenNames = hidden.map((t) => t.name).join(", ");

  return (
    <span ref={boxRef} className="relative flex w-full min-w-0 items-center gap-1 overflow-hidden">
      {shown.map((tag) => (
        <TagChip key={tag.id} name={tag.name} color={tag.color} className="min-w-0" />
      ))}
      {hidden.length > 0 && (
        <span
          title={hiddenNames}
          aria-label={`y ${hidden.length} ${hidden.length === 1 ? "etiqueta" : "etiquetas"} más: ${hiddenNames}`}
          className="inline-flex shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >
          +{hidden.length}
        </span>
      )}
      {/* Fila invisible para medir: todos los chips y el «+N» más ancho posible. */}
      <span ref={measureRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex gap-1 whitespace-nowrap">
        {tags.map((tag) => (
          <TagChip key={tag.id} name={tag.name} color={tag.color} className="shrink-0" />
        ))}
        <span className="inline-flex shrink-0 rounded-full border border-border px-2 py-0.5 text-xs font-medium">+{tags.length}</span>
      </span>
    </span>
  );
}
