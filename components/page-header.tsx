import type { ReactNode } from "react";
import { InfoTooltip } from "@/components/ui/tooltip";

/**
 * Barra superior de 56 px, igual en todas las páginas (F13). Título · ⓘ con
 * tooltip · controles propios a la izquierda · espacio · controles a la
 * derecha. Sin subtítulo: lo que antes era subtítulo va al tooltip.
 */
export function PageHeader({
  title,
  tooltip,
  left,
  right,
}: {
  title: string;
  tooltip?: string;
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-border px-4 md:px-6">
      <h1 className="text-base font-semibold">{title}</h1>
      {tooltip && <InfoTooltip text={tooltip} />}
      {left}
      <div className="flex-1" />
      {right}
    </header>
  );
}
