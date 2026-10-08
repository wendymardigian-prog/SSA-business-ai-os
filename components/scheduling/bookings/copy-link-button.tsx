"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copiar un link, con el mismo "Copiado ✓" de dos segundos que
 * `components/dashboards/trend-explorer.tsx`. Acá recibe la URL en vez de
 * armarla (la pantalla no tiene una configuración propia que codificar: tiene
 * el link de un evento).
 */
export function CopyLinkButton({ url, label = "Copiar link", className }: { url: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:bg-accent", className)}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? "Copiado" : label}
    </button>
  );
}
