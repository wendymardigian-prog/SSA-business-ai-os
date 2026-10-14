"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La URL de entrada completa de una visita (plano formularios-ui, F19): la direccion por la que llego
 * la persona, con todos sus parametros. Texto monoespaciado que corta las lineas largas y un boton
 * Copiar. Nunca se loguea; solo se muestra y se copia a pedido.
 */
export function EntryUrlBlock({ url, className }: { url: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("error");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <div className={cn("rounded-lg border border-border bg-muted/30 p-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">URL de entrada completa</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Copiar la URL de entrada completa"
        >
          {state === "copied" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {state === "copied" ? "Copiada" : state === "error" ? "No se pudo copiar" : "Copiar"}
        </button>
      </div>
      <code className="mt-1.5 block break-all font-mono text-[11.5px] leading-relaxed text-foreground/90">{url}</code>
    </div>
  );
}
