import type { TaxonomyTag } from "@/lib/content/taxonomy";
import { cn } from "@/lib/utils";

/**
 * El pilar de una idea o pieza como lo ven las tarjetas y la lista (F91): un
 * punto con su color y el nombre. Un pilar archivado se sigue mostrando
 * (apagado y marcado): quitarlo de la tarjeta haria creer que la pieza no lo
 * tiene.
 */
export function PillarDot({ tag, className }: { tag: TaxonomyTag; className?: string }) {
  return (
    <span
      className={cn("ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground", tag.archived && "opacity-70", className)}
      title={tag.archived ? `${tag.name} (archivado)` : `Pilar: ${tag.name}`}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: tag.color ?? "#64748b" }}
      />
      {tag.name}
    </span>
  );
}
