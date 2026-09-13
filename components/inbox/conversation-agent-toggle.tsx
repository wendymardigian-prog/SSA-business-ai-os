"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, PauseCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setConversationAgent } from "@/lib/actions/conversation-agent";
import type { ChannelAgentInfo } from "@/lib/agent/public";

/**
 * Toggle del agente de IA en una conversacion (F31).
 *
 * El estado tiene que ser obvio: encendido, apagado, bloqueado (y por que) o
 * pausado por un flow. Con el maestro del canal apagado el switch queda en off,
 * deshabilitado, con el motivo escrito al lado y no escondido en un tooltip.
 */
export function ConversationAgentToggle({
  conversationId,
  enabled,
  pausedUntil,
  info,
}: {
  conversationId: string;
  enabled: boolean;
  pausedUntil: string | null;
  info: ChannelAgentInfo | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [askAssignment, setAskAssignment] = useState<{ assignedName: string | null } | null>(null);
  const reasonId = useId();

  // El instante se toma una vez al montar: un render no puede leer el reloj.
  const [mountedAt] = useState(() => Date.now());
  const blocked = !info?.available;
  const paused =
    enabled && pausedUntil !== null && (pausedUntil === "infinity" || new Date(pausedUntil).getTime() > mountedAt);

  function send(next: boolean, assignment?: "keep" | "reassign") {
    setError(null);
    start(async () => {
      const result = await setConversationAgent({ conversationId, enabled: next, assignment });
      if (result.ok) {
        setAskAssignment(null);
        router.refresh();
        return;
      }
      if ("needsAssignmentChoice" in result) {
        setAskAssignment({ assignedName: result.assignedName });
        return;
      }
      setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end">
      <div className="flex items-center gap-2">
        {paused ? (
          <PauseCircle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
        ) : (
          <Bot className={enabled && !blocked ? "h-3.5 w-3.5 text-emerald-600" : "h-3.5 w-3.5 text-muted-foreground"} aria-hidden />
        )}
        <span className="text-[11px] font-medium text-muted-foreground">
          {blocked ? "Agente IA no disponible" : paused ? "Agente IA pausado por un flow" : enabled ? "Agente IA" : "Agente IA apagado"}
        </span>
        <Switch
          size="sm"
          checked={enabled && !blocked}
          disabled={blocked || pending}
          onChange={(next) => send(next)}
          label="Agente de IA en esta conversacion"
          describedBy={blocked ? reasonId : undefined}
        />
      </div>
      {blocked && info?.message && (
        <p id={reasonId} className="mt-0.5 max-w-xs text-right text-[10px] text-muted-foreground">
          {info.message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-0.5 max-w-xs text-right text-[10px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {askAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={`${reasonId}-t`}>
          <div className="fixed inset-0 bg-black/50" onClick={() => setAskAssignment(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg">
            <h3 id={`${reasonId}-t`} className="text-sm font-semibold text-foreground">
              ¿Mantener la asignación o reasignar al agente?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Esta conversación está asignada a {askAssignment.assignedName ?? "una persona del equipo"}. El agente responde
              igual en los dos casos: la asignación es para organizar y filtrar.
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setAskAssignment(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => send(true, "keep")}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Mantener asignación
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => send(true, "reassign")}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                autoFocus
              >
                Reasignar al agente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
