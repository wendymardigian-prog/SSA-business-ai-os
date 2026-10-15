"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, ChevronDown, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { setConversationAgent } from "@/lib/actions/conversation-agent";
import { toAgentMode, type ConversationAgentMode } from "@/lib/agent/config";
import type { ChannelAgentInfo } from "@/lib/agent/public";

/**
 * El agente de IA en una conversacion, con sus tres estados (F31, 00066):
 * heredar del canal (default), forzado prendido, forzado apagado.
 *
 * Es un desplegable para que el encabezado entre en una linea: el boton dice
 * el estado elegido y su tooltip explica que significa HOY ("el agente atiende
 * Instagram, asi que esta conversacion si"); adentro, cada opcion trae su
 * explicacion. Pausado por un flow se ve en el icono y en el tooltip.
 */

const MODE_LABELS: Record<ConversationAgentMode, string> = {
  inherit: "Heredar",
  on: "Prendido",
  off: "Apagado",
};

const MODES = Object.keys(MODE_LABELS) as ConversationAgentMode[];

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

/** Lo que significa cada opcion del desplegable, con el canal de esta conversacion. */
export function agentModeOptionHelp(mode: ConversationAgentMode, info: ChannelAgentInfo | null): string {
  const channel = info?.channelLabel ?? "el canal";
  const attends = Boolean(info?.available);
  if (mode === "inherit") {
    return attends
      ? `Hace lo mismo que ${channel}: hoy el agente lo atiende, así que acá responde.`
      : `Hace lo mismo que ${channel}: hoy el agente no lo atiende, así que acá no responde.`;
  }
  if (mode === "on") {
    return attends
      ? "El agente responde en esta conversación, cambie lo que cambie en el canal."
      : `No disponible: ${info?.message ?? `el agente no atiende ${channel}`}.`;
  }
  return "El agente no responde en esta conversación, aunque atienda el canal.";
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
  const [open, setOpen] = useState(false);
  const groupId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const mode = toAgentMode(rawMode);
  const { on, text } = describeAgentMode(mode, info);
  // El instante se toma una vez al montar: un render no puede leer el reloj.
  const [mountedAt] = useState(() => Date.now());
  const paused = on && pausedUntil !== null && (pausedUntil === "infinity" || new Date(pausedUntil).getTime() > mountedAt);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Mismo comportamiento que components/ui/popover.tsx: Esc devuelve el foco
  // al boton y un clic afuera cierra.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

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

  function choose(next: ConversationAgentMode) {
    close(true);
    if (next !== mode) send(next);
  }

  const tip = (
    <span className="block">
      <span className="block">{paused ? "Pausado por un flow. " : ""}{text}</span>
      {error && <span className="mt-1 block text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      {/* Arriba: abajo taparia el desplegable recien abierto. */}
      <Tip content={open ? null : tip} side="top" align="center">
        <button
          ref={buttonRef}
          type="button"
          aria-label={`Agente de IA en esta conversación: ${MODE_LABELS[mode]}`}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? `${groupId}-menu` : undefined}
          aria-describedby={`${groupId}-d`}
          disabled={pending}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium transition-colors hover:bg-accent disabled:opacity-60",
            error ? "border-red-400 text-red-700 dark:text-red-300" : "border-border text-foreground",
          )}
        >
          {paused ? (
            <PauseCircle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
          ) : (
            <Bot className={on ? "h-3.5 w-3.5 text-emerald-600" : "h-3.5 w-3.5 text-muted-foreground"} aria-hidden />
          )}
          <span className="text-muted-foreground">IA:</span>
          {MODE_LABELS[mode]}
          <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />
        </button>
      </Tip>
      {/* La explicacion del estado, para el lector de pantalla (el tooltip
          solo aparece con hover o foco). */}
      <span id={`${groupId}-d`} className="sr-only">
        {paused ? "Pausado por un flow. " : ""}
        {text}
      </span>
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}

      {open && (
        <div
          id={`${groupId}-menu`}
          role="radiogroup"
          aria-label="Agente de IA en esta conversación"
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          {MODES.map((m) => {
            const disabled = pending || (m === "on" && !info?.available);
            const selected = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => choose(m)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  selected ? "bg-accent" : "hover:bg-accent",
                )}
              >
                <Check className={cn("mt-0.5 h-3.5 w-3.5 flex-shrink-0", selected ? "text-primary" : "invisible")} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">{MODE_LABELS[m]}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{agentModeOptionHelp(m, info)}</span>
                </span>
              </button>
            );
          })}
        </div>
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
