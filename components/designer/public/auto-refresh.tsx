"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Mientras una pieza se prepara, vuelve a pedir la página cada unos segundos (hasta un tope) para que aparezca
 * sola cuando termina el render. No muestra nada.
 */
export function AutoRefresh({ everyMs = 6000, max = 30 }: { everyMs?: number; max?: number }) {
  const router = useRouter();
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tries > max) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs, max]);
  return null;
}
