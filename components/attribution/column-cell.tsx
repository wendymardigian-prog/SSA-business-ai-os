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
/** Solo un https:// se dibuja como link (lo que guardó un formulario ya pasó por esa regla; esto es la red de seguridad). */
const isHttpsLink = (value: string) => /^https:\/\/\S+$/i.test(value);

/** Lo de adentro de la celda (para la tabla común, que pone su propio `<td>`). */
export function ColumnCellContent<Row>({ def, row }: { def: ColumnDef<Row>; row: Row }) {
  const value = def.value(row);
  if (!value) return <span className="text-muted-foreground">—</span>;
  if (def.link && isHttpsLink(value)) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" title={value} className="block truncate text-primary-ink underline-offset-2 hover:underline">
        {value}
      </a>
    );
  }
  if (def.copyable) {
    return (
      <div className="flex items-center gap-1" title={value}>
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <CopyCellButton value={value} label={def.label} />
      </div>
    );
  }
  return (
    <div className="truncate" title={value}>
      {value}
    </div>
  );
}
