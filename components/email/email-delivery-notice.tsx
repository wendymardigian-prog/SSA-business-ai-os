"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { loadEmailDeliveryNotice } from "@/lib/actions/email-delivery";

/**
 * El aviso rojo de la guardia de entrega (00287): si los rebotes y quejas de Resend no llegan (webhook desactivado o
 * sin esos eventos), el freno automatico no puede funcionar. Avisa, no bloquea. Lo usan el editor de broadcasts (canal
 * email) y el paso «Enviar email». Si no se puede leer, no muestra nada.
 */
export function EmailDeliveryNotice({ className = "" }: { className?: string }) {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadEmailDeliveryNotice()
      .then((text) => {
        if (alive) setNotice(text);
      })
      .catch(() => {
        /* sin aviso: nunca rompe el editor */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!notice) return null;
  return (
    <p role="alert" className={`flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 ${className}`}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{notice}</span>
    </p>
  );
}
