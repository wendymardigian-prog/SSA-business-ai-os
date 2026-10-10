"use client";

import { useLinkStatus } from "next/link";

/**
 * Un puntito que late mientras carga el destino de un <Link>. Va ADENTRO del
 * Link (useLinkStatus lee el link que lo contiene).
 *
 * Para las pestañas y los menus: sin esto, al hacer clic no cambiaba nada en
 * pantalla hasta que la pagina nueva llegaba entera, y parecia que el clic no
 * habia andado.
 */
export function LinkPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 rounded-full bg-primary transition-opacity ${pending ? "animate-pulse opacity-100" : "opacity-0"} ${className}`}
    />
  );
}
