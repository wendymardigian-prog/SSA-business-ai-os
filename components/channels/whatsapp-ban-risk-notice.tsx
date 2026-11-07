import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * La advertencia de un WhatsApp conectado por Evolution API (QR, Baileys): no es la API oficial, y WhatsApp puede bloquear
 * el numero por automatizar. Avisa, no frena nada. Un solo texto para Canales, los avisos al equipo y los pasos de un flujo
 * que siempre salen por WhatsApp. `children` suma lo propio de esa pantalla.
 */
export function WhatsappBanRiskNotice({ className = "", children }: { className?: string; children?: ReactNode }) {
  return (
    <div role="note" className={`flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300 ${className}`}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">Riesgo de bloqueo del número</p>
        <p>
          Este WhatsApp se conecta por código QR (Evolution API), no por la API oficial de WhatsApp. WhatsApp puede restringir o bloquear el número si detecta
          automatizaciones, sobre todo muchos mensajes seguidos o a gente que no te conoce. Los topes del sistema bajan el riesgo, pero no lo eliminan: evitá
          automatizar desde un número que no puedas perder.
        </p>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}
