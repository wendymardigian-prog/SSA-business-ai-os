"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2 } from "lucide-react";
import { noReplyBadge, type AwaitingRow } from "@/lib/inbox/awaiting";
import { setConversationNoReply } from "@/lib/actions/conversation-status";

/**
 * "No necesita respuesta" (00259), entre el encabezado y el hilo.
 *
 * Gris y discreto: no es una alerta, es una explicacion de por que esta
 * conversacion no cuenta en "Esperando respuesta". Dice quien lo decidio (la
 * regla de cierre, el agente o alguien del equipo) y deja deshacerlo: la regla y
 * el agente pueden equivocarse, y entonces la conversacion vuelve a la cuenta.
 *
 * Se va sola cuando el lead vuelve a escribir o le respondemos.
 */
export function NoReplyBanner({
  conversationId,
  conversation,
  canReply,
}: {
  conversationId: string;
  conversation: Pick<AwaitingRow, "no_reply_needed_at" | "no_reply_needed_reason" | "awaiting_last_inbound_at">;
  /** Sin permiso para responder por esta cuenta se ve, pero no se deshace. */
  canReply: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const badge = noReplyBadge(conversation);
  if (!badge.show) return null;

  function undo() {
    start(async () => {
      const result = await setConversationNoReply(conversationId, false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-2" role="status">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <CheckCheck className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{badge.label}.</span> {badge.detail}
        </p>
        {canReply && (
          <button
            type="button"
            onClick={undo}
            disabled={pending}
            className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            Sí necesita respuesta
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1.5 text-xs font-medium text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
