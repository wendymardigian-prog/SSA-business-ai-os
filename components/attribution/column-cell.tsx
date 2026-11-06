"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { ColumnDef } from "@/lib/attribution/columns";
import { cn } from "@/lib/utils";

/** Copia el valor completo de una celda recortada, como la URL de entrada. No abre la fila en la que está. */
function CopyCellButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(event: React.MouseEvent) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" onClick={copy} aria-label={`Copiar ${label}`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
    </button>
  );
}

/** Una celda de una columna del catálogo: un dato que falta es «—», nunca 0. */
export function ColumnCell<Row>({ def, row, className }: { def: ColumnDef<Row>; row: Row; className?: string }) {
  const value = def.value(row);
  if (!value) return <td className={cn("px-3 py-2 text-muted-foreground", className)}>—</td>;
  return (
    <td className={cn("max-w-[16rem] px-3 py-2", className)} title={value}>
      {def.copyable ? (
        <div className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate">{value}</span>
          <CopyCellButton value={value} label={def.label} />
        </div>
      ) : (
        <div className="truncate">{value}</div>
      )}
    </td>
  );
}
