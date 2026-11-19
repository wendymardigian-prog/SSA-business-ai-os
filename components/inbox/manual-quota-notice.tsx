"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { getGroupQuotaWarningAction, getManualQuotaWarningAction } from "@/lib/actions/send-quota";
import { manualQuotaText, type ManualQuotaWarning } from "@/lib/send-queue/automation/manual-quota";

type Target = { conversationId: string; groupId?: undefined } | { groupId: string; conversationId?: undefined };

/**
 * Aviso de cupo gastado encima del cuadro de escribir. Solo WhatsApp: el chat privado (`conversationId`) o un grupo
 * (`groupId`; un grupo siempre es de WhatsApp).
 *
 * No frena nada: el botón de mandar sigue igual y el mensaje sale. Se vuelve a mirar al cambiar de conversación o de
 * grupo y cada vez que cambia el número de mensajes del hilo (por ejemplo, justo después de mandar uno).
 */
export function ManualQuotaNotice({ provider, refreshKey, ...target }: Target & { provider: string | null; refreshKey: number | string }) {
  const [warning, setWarning] = useState<{ id: string; w: ManualQuotaWarning } | null>(null);
  const id = target.groupId ?? target.conversationId;
  const isGroup = target.groupId !== undefined;
  const active = provider === "evolution";

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (isGroup ? getGroupQuotaWarningAction(id) : getManualQuotaWarningAction(id))
      .then((w) => {
        if (!cancelled) setWarning(w ? { id, w } : null);
      })
      .catch((err: unknown) => {
        // Sin aviso no pasa nada grave: el mensaje sale igual. Solo se registra.
        console.error("[cupo manual] no pude comprobar el cupo:", err instanceof Error ? err.message : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [active, id, isGroup, refreshKey]);

  if (!active || !warning || warning.id !== id) return null;
  const text = manualQuotaText(warning.w);
  return (
    <div
      role="status"
      data-testid="manual-quota-notice"
      className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
      <p className="min-w-0">
        <span className="font-medium">{text.title}</span> {text.detail}
      </p>
    </div>
  );
}
