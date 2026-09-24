"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { setConversationAgent } from "@/lib/actions/conversation-agent";
import { toAgentMode, type ConversationAgentMode } from "@/lib/agent/config";
import type { ChannelAgentInfo } from "@/lib/agent/public";

/**
 * El agente de IA en una conversacion, con sus tres estados (F31, 00066):
 * heredar del canal (default), forzado prendido, forzado apagado.
 *
 * El estado tiene que ser obvio. En "heredar" se dice que se esta heredando
 * ("el agente atiende Instagram, asi que esta conversacion si"); en los
 * forzados, que alguien lo decidio aca. Pausado por un flow y bloqueado por el
 * maestro se muestran con el motivo escrito, no en un tooltip.
 */

const MODE_LABELS: Record<ConversationAgentMode, string> = {
  inherit: "Heredar",
  on: "Prendido",
  off: "Apagado",
};

export function describeAgentMode(mode: ConversationAgentMode, info: ChannelAgentInfo | null): { on: boolean; text: string } {
  const channel = info?.channelLabel ?? "este canal";
  const attends = Boolean(info?.available);
  if (mode === "off") {
    return { on: false, text: `Apagado en esta conversación: el agente no responde acá${attends ? ` aunque atienda ${channel}` : ""}.` };
  }
  if (mode === "on") {
    return attends
      ? { on: true, text: `Prendido en esta conversación: el agente responde acá.` }
      : { on: false, text: `Prendido acá, pero ${info?.message ?? `el agente no atiende ${channel}`}` };
  }
  return attends
    ? { on: true, text: `Heredando del canal: el agente atiende ${channel}, así que esta conversación sí.` }
    : { on: false, text: `Heredando del canal: ${info?.message ?? `el agente no atiende ${channel}, así que esta conversación no.`}` };
}

export function ConversationAgentToggle({
  conversationId,
  mode: rawMode,
  pausedUntil,
  info,
}: {
  conversationId: string;
  /** conversations.agent_enabled: null = heredar, true = prendido, false = apagado. */
  mode: boolean | null;
  pausedUntil: string | null;
  info: ChannelAgentInfo | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [askAssignment, setAskAssignment] = useState<{ assignedName: string | null; mode: ConversationAgentMode } | null>(null);
  const groupId = useId();

  const mode = toAgentMode(rawMode);
  const { on, text } = describeAgentMode(mode, info);
  // El instante se toma una vez al montar: un render no puede leer el reloj.
  const [mountedAt] = useState(() => Date.now());
  const paused = on && pausedUntil !== null && (pausedUntil === "infinity" || new Date(pausedUntil).getTime() > mountedAt);

  function send(next: ConversationAgentMode, assignment?: "keep" | "reassign") {
    setError(null);
    start(async () => {
      const result = await setConversationAgent({ conversationId, mode: next, assignment });
      if (result.ok) {
        setAskAssignment(null);
        router.refresh();
        return;
      }
      if ("needsAssignmentChoice" in result) {
        setAskAssignment({ assignedName: result.assignedName, mode: next });
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
          <Bot className={on ? "h-3.5 w-3.5 text-emerald-600" : "h-3.5 w-3.5 text-muted-foreground"} aria-hidden />
        )}
        <span className="text-[11px] font-medium text-muted-foreground">
          {paused ? "Agente IA pausado por un flow" : on ? "Agente IA" : "Agente IA apagado"}
        </span>
        <div
          role="radiogroup"
          aria-label="Agente de IA en esta conversacion"
          aria-describedby={`${groupId}-d`}
          className="flex overflow-hidden rounded-md border border-border text-[11px]"
        >
          {(Object.keys(MODE_LABELS) as ConversationAgentMode[]).map((m) => {
            const disabled = pending || (m === "on" && !info?.available);
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                disabled={disabled}
                onClick={() => mode !== m && send(m)}
                className={cn(
                  "px-2 py-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {MODE_LABELS[m]}
              </button>
            );
          })}
        </div>
      </div>
      <p id={`${groupId}-d`} className="mt-0.5 max-w-xs text-right text-[10px] text-muted-foreground">
        {text}
      </p>
      {error && (
        <p role="alert" className="mt-0.5 max-w-xs text-right text-[10px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {askAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={`${groupId}-t`}>
          <div className="fixed inset-0 bg-black/50" onClick={() => setAskAssignment(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg">
            <h3 id={`${groupId}-t`} className="text-sm font-semibold text-foreground">
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
                onClick={() => send(askAssignment.mode, "keep")}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Mantener asignación
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => send(askAssignment.mode, "reassign")}
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
