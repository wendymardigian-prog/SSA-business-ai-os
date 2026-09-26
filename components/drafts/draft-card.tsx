"use client";

import { useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Bot, Check, Loader2, MessageSquareReply, MoreHorizontal, Pencil, RefreshCw, Send, Trash2, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { discardDraftAction, regenerateDraftAction, sendDraftAction } from "@/lib/actions/agent-drafts";
import type { DraftActionResult } from "@/lib/agent/drafts/actions";
import type { DraftQueueRow } from "@/lib/agent/drafts/queue-query";
import { noReplyReasonLabel, type AppliedAction, type SuggestedAction } from "@/lib/agent/drafts/types";
import type { Platform } from "@/lib/platforms";
import { WindowBadge } from "./window-badge";

/**
 * Un borrador del agente y las decisiones sobre el (Bloque 2c). Dos formas:
 *
 *   - "queue": una fila de la cola, en cinco columnas (contacto, lo que
 *     escribio el lead, la respuesta propuesta, lo que hizo el agente, la
 *     decision).
 *   - "thread": arriba del campo de escritura de la conversacion, con borde
 *     punteado y el rotulo "no enviado". Nunca con el aspecto de un mensaje.
 *
 * Atajo: Cmd/Ctrl + Enter envia el borrador que tiene el foco (tambien desde
 * el texto que se esta editando). Escape cancela la edicion.
 */

type Mode = "idle" | "editing" | "regenerating" | "discarding";

// Fijo y no detectado: calcularlo con navigator cambiaria entre el servidor y
// el navegador y rompería la hidratacion.
const SHORTCUT = "⌘/Ctrl+↵";

function useDraftDecision(draft: DraftQueueRow, onDone: () => void) {
  const [mode, setMode] = useState<Mode>("idle");
  const [text, setText] = useState(draft.body ?? "");
  const [instruction, setInstruction] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDnc, setConfirmDnc] = useState(false);
  const [pending, start] = useTransition();

  const closed = draft.window.level === "closed";
  const canSend = Boolean(draft.body) && !closed && (draft.status === "pending" || draft.status === "failed");

  function finish(result: DraftActionResult) {
    if (result.ok) {
      setError(null);
      setMode("idle");
      if (result.notice) setNotice(result.notice);
      onDone();
      return;
    }
    if (result.code === "needs_confirmation") {
      setConfirmDnc(true);
      return;
    }
    setError(result.error);
    // Lo que cambio afuera (otra persona decidio, el lead escribio) se ve al refrescar.
    if (["already_decided", "superseded", "answered_elsewhere"].includes(result.code)) onDone();
  }

  function send(confirmed = false) {
    if (!canSend || pending) return;
    setError(null);
    const body = mode === "editing" ? text : null;
    start(async () => finish(await sendDraftAction(draft.id, { body, confirmedDoNotContact: confirmed })));
  }
  function discard() {
    setError(null);
    start(async () => finish(await discardDraftAction(draft.id, reason)));
  }
  function regenerate() {
    setError(null);
    start(async () => finish(await regenerateDraftAction(draft.id, instruction)));
  }

  return {
    mode,
    setMode: (next: Mode) => {
      setError(null);
      if (next === "editing") setText(draft.body ?? "");
      setMode(next);
    },
    text,
    setText,
    instruction,
    setInstruction,
    reason,
    setReason,
    error,
    notice,
    pending,
    closed,
    canSend,
    send,
    discard,
    regenerate,
    confirmDnc,
    setConfirmDnc,
  };
}

type Decision = ReturnType<typeof useDraftDecision>;

function onShortcut(decision: Decision) {
  return (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      decision.send();
    }
  };
}

// ---------------------------------------------------------------------------
// Piezas compartidas
// ---------------------------------------------------------------------------

function contactName(draft: DraftQueueRow): string {
  return draft.contact.name || (draft.contact.username ? `@${draft.contact.username}` : "Sin nombre");
}

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

function describeApplied(action: AppliedAction): string {
  const detail = action.detail && typeof action.detail === "object" ? (action.detail as Record<string, unknown>) : null;
  const bits = detail
    ? Object.values(detail)
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
        .slice(0, 3)
    : [];
  return bits.length ? `${action.label}: ${bits.join(", ")}` : action.label;
}

function describeSuggestion(s: SuggestedAction): string {
  if (s.type === "escalate") return `Sugiere derivar a una persona: ${s.reason}`;
  return `Sugiere pausarse ${s.minutes >= 60 ? `${Math.round(s.minutes / 60)} h` : `${s.minutes} min`}: ${s.reason}`;
}

function BurstQuote({ draft }: { draft: DraftQueueRow }) {
  if (draft.burst.length === 0) return <p className="text-xs text-muted-foreground">Los mensajes ya no están disponibles.</p>;
  return (
    <ul className="space-y-1">
      {draft.burst.map((m) => (
        <li key={m.id} className="border-l-2 border-border pl-2 text-sm">
          <span className="whitespace-pre-wrap break-words">{m.text || "(adjunto)"}</span>
          <span className="ml-1.5 text-[11px] text-muted-foreground">
            {new Date(m.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProposedReply({ draft, decision }: { draft: DraftQueueRow; decision: Decision }) {
  if (decision.mode === "editing") {
    return (
      <div className="space-y-1">
        <label htmlFor={`draft-edit-${draft.id}`} className="sr-only">
          Editar la respuesta
        </label>
        <textarea
          id={`draft-edit-${draft.id}`}
          value={decision.text}
          onChange={(e) => decision.setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              decision.setMode("idle");
            }
          }}
          rows={Math.min(10, Math.max(3, Math.ceil(decision.text.length / 60)))}
          autoFocus
          // Crece con el texto (field-sizing donde el navegador lo soporta; el
          // calculo de rows queda como respaldo). En el telefono el tope es la
          // mitad de la pantalla: el teclado ocupa la otra mitad.
          className="field-sizing-content max-h-[50dvh] min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring queue:text-sm"
        />
        <p className="hidden text-[11px] text-muted-foreground queue:block">{SHORTCUT} envía el texto editado · Esc cancela</p>
      </div>
    );
  }
  if (!draft.body) {
    return (
      <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Sin respuesta:</span> {noReplyReasonLabel(draft.noReplyReason)}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {(draft.bodyParts.length > 1 ? draft.bodyParts : [draft.body]).map((part, i) => (
        <p key={i} className="whitespace-pre-wrap break-words rounded-lg bg-muted/60 px-3 py-2 text-sm">
          {part}
        </p>
      ))}
      {draft.bodyParts.length > 1 && <p className="text-[11px] text-muted-foreground">Sale en {draft.bodyParts.length} mensajes.</p>}
    </div>
  );
}

function AgentActions({ draft }: { draft: DraftQueueRow }) {
  if (draft.appliedActions.length === 0 && draft.suggestedActions.length === 0) {
    return <p className="text-xs text-muted-foreground">No tocó el CRM.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {draft.appliedActions.map((a, i) => (
        <li key={`a-${i}`} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <Check className="h-3 w-3" aria-hidden />
          {describeApplied(a)}
        </li>
      ))}
      {draft.suggestedActions.map((s, i) => (
        <li
          key={`s-${i}`}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-amber-400 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-200"
          title="No se ejecutó: se aplica si enviás este borrador"
        >
          {s.type === "escalate" ? <UserRound className="h-3 w-3" aria-hidden /> : <Ban className="h-3 w-3" aria-hidden />}
          {describeSuggestion(s)}
        </li>
      ))}
    </ul>
  );
}

function Btn({
  onClick,
  children,
  variant = "secondary",
  disabled,
  title,
  className,
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        className,
        // 44 px de alto en el telefono y la tableta (se aprueba con el pulgar);
        // compacto recien donde la cola es una tabla.
        "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 queue:min-h-0 queue:px-2.5 queue:py-1.5 queue:text-xs",
        variant === "primary" && "bg-primary text-primary-foreground hover:opacity-90",
        variant === "secondary" && "border border-input hover:bg-accent",
        variant === "danger" && "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40",
      )}
    >
      {children}
    </button>
  );
}

function Decisions({ draft, decision, inboxHref }: { draft: DraftQueueRow; decision: Decision; inboxHref: string | null }) {
  const d = decision;
  if (d.mode === "regenerating") {
    return (
      <div className="space-y-1.5">
        <label htmlFor={`draft-regen-${draft.id}`} className="text-xs font-medium">
          Qué cambiar (opcional)
        </label>
        <input
          id={`draft-regen-${draft.id}`}
          value={d.instruction}
          onChange={(e) => d.setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              d.regenerate();
            }
            if (e.key === "Escape") d.setMode("idle");
          }}
          placeholder="más corto, no menciones el precio…"
          maxLength={500}
          autoFocus
          className="min-h-11 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-ring queue:min-h-0 queue:text-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          <Btn variant="primary" onClick={d.regenerate} disabled={d.pending}>
            {d.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Pedir otra versión
          </Btn>
          <Btn onClick={() => d.setMode("idle")}>Cancelar</Btn>
        </div>
      </div>
    );
  }
  if (d.mode === "discarding") {
    return (
      <div className="space-y-1.5">
        <label htmlFor={`draft-discard-${draft.id}`} className="text-xs font-medium">
          Por qué lo descartás (opcional)
        </label>
        <input
          id={`draft-discard-${draft.id}`}
          value={d.reason}
          onChange={(e) => d.setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              d.discard();
            }
            if (e.key === "Escape") d.setMode("idle");
          }}
          maxLength={300}
          autoFocus
          className="min-h-11 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-ring queue:min-h-0 queue:text-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          <Btn variant="danger" onClick={d.discard} disabled={d.pending}>
            {d.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Descartar
          </Btn>
          <Btn onClick={() => d.setMode("idle")}>Cancelar</Btn>
        </div>
      </div>
    );
  }

  const sending = draft.status === "sending";
  const editing = d.mode === "editing";
  const canEdit = d.canSend && !editing;
  const canRegenerate = !sending && !editing && !d.closed;
  // Lo secundario (editar, regenerar): en la tabla va en fila; en el telefono,
  // detras de "Mas", para que Enviar y Descartar entren al alcance del pulgar.
  const secondary = (inMenu: boolean) => (
    <>
      {canEdit && (
        <Btn onClick={() => d.setMode("editing")} className={inMenu ? "w-full justify-start" : undefined}>
          <Pencil className="h-3.5 w-3.5" /> Editar
        </Btn>
      )}
      {canRegenerate && (
        <Btn onClick={() => d.setMode("regenerating")} className={inMenu ? "w-full justify-start" : undefined}>
          <RefreshCw className="h-3.5 w-3.5" /> Regenerar
        </Btn>
      )}
    </>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sending ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saliendo…
        </span>
      ) : d.canSend ? (
        <Btn variant="primary" onClick={() => d.send()} disabled={d.pending} title={`Enviar (${SHORTCUT})`} className="flex-1 queue:flex-none">
          {d.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {editing ? "Enviar editado" : draft.status === "failed" ? "Reintentar" : "Enviar"}
          <kbd className="ml-0.5 hidden rounded bg-primary-foreground/20 px-1 text-[10px] queue:inline">{SHORTCUT}</kbd>
        </Btn>
      ) : (
        inboxHref && (
          <Link
            href={inboxHref}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 queue:min-h-0 queue:flex-none queue:px-2.5 queue:py-1.5 queue:text-xs"
          >
            <MessageSquareReply className="h-3.5 w-3.5" /> Responder a mano
          </Link>
        )
      )}
      {editing && (
        <Btn onClick={() => d.setMode("idle")}>
          <X className="h-3.5 w-3.5" /> Cancelar
        </Btn>
      )}
      {!sending && !editing && (
        <>
          <span className="hidden gap-1.5 queue:inline-flex">{secondary(false)}</span>
          <Btn onClick={() => d.setMode("discarding")}>
            <Trash2 className="h-3.5 w-3.5" /> Descartar
          </Btn>
          {(canEdit || canRegenerate) && (
            <details className="relative queue:hidden">
              <summary
                aria-label="Más acciones"
                className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-lg border border-input hover:bg-accent [&::-webkit-details-marker]:hidden"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </summary>
              <div className="absolute bottom-full right-0 z-20 mb-2 flex w-44 flex-col gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg">
                {secondary(true)}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Feedback({ draft, decision }: { draft: DraftQueueRow; decision: Decision }) {
  return (
    <>
      {draft.status === "failed" && draft.sendError && !decision.error && (
        <p className="text-xs text-red-700 dark:text-red-300">No salió: {draft.sendError}</p>
      )}
      {decision.error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {decision.error}
        </p>
      )}
      {decision.notice && <p className="text-xs text-emerald-700 dark:text-emerald-300">{decision.notice}</p>}
      <ConfirmDialog
        open={decision.confirmDnc}
        title="Este contacto pidió no ser contactado"
        message={
          draft.contact.doNotContactReason
            ? `Motivo registrado: ${draft.contact.doNotContactReason}. ¿Enviás la respuesta igual?`
            : "¿Enviás la respuesta igual?"
        }
        confirmLabel="Enviar igual"
        destructive
        onConfirm={() => {
          decision.setConfirmDnc(false);
          decision.send(true);
        }}
        onCancel={() => decision.setConfirmDnc(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Fila de la cola
// ---------------------------------------------------------------------------

export function DraftQueueItem({
  draft,
  ownerLabel,
  onDone,
}: {
  draft: DraftQueueRow;
  /** De quien es: nombre, o null = sin asignar. */
  ownerLabel: string | null;
  onDone: () => void;
}) {
  const decision = useDraftDecision(draft, onDone);
  const inboxHref = `/dashboard/inbox?c=${draft.conversationId}`;
  const decided = !["pending", "sending", "failed"].includes(draft.status);

  return (
    <li
      tabIndex={0}
      onKeyDown={onShortcut(decision)}
      aria-label={`Borrador para ${contactName(draft)}`}
      // Abajo de 980 px es una tarjeta: contacto y canal, la ventana (lo
      // primero que decide si vale la pena leer el resto), lo que escribio, la
      // respuesta, lo que hizo el agente y los botones al pie. Arriba, las
      // cinco columnas de siempre.
      className="grid grid-cols-1 gap-3 px-4 pt-4 outline-none focus-within:bg-accent/30 focus:bg-accent/30 queue:grid-cols-[minmax(150px,0.9fr)_minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(200px,1fr)] queue:pb-4"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={draft.channel.platform as Platform} className="h-4 w-4 shrink-0" size={16} />
          <Link href={inboxHref} className="truncate text-sm font-medium hover:underline">
            {contactName(draft)}
          </Link>
        </div>
        <p className={cn("text-xs", ownerLabel ? "text-muted-foreground" : "font-medium text-amber-700 dark:text-amber-300")}>
          {ownerLabel ? `De ${ownerLabel}` : "Sin asignar"}
        </p>
        {draft.contact.doNotContact && <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">No contactar</p>}
        {draft.agentOffByTag && (
          <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">
            Contacto marcado con una etiqueta que apaga el agente: revisá antes de enviar.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 queue:hidden">
        <WindowBadge info={draft.window} />
        <span className="text-[11px] text-muted-foreground">{timeAgo(draft.createdAt)}</span>
      </div>

      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium uppercase text-muted-foreground queue:hidden">Lo que escribió</p>
        <BurstQuote draft={draft} />
      </div>

      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium uppercase text-muted-foreground queue:hidden">Respuesta propuesta</p>
        {decided ? <DecidedSummary draft={draft} /> : <ProposedReply draft={draft} decision={decision} />}
      </div>

      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium uppercase text-muted-foreground queue:hidden">Lo que hizo el agente</p>
        <AgentActions draft={draft} />
      </div>

      <div className="min-w-0 space-y-2 pb-4 queue:pb-0">
        <div className="hidden flex-wrap items-center gap-1.5 queue:flex">
          <WindowBadge info={draft.window} />
          <span className="text-[11px] text-muted-foreground">{timeAgo(draft.createdAt)}</span>
        </div>
        <Feedback draft={draft} decision={decision} />
        {!decided && (
          // En el telefono la barra de botones queda pegada al pie mientras la
          // tarjeta esta en pantalla. sticky y no fixed: el teclado no la tapa.
          <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 px-4 py-2 backdrop-blur queue:static queue:mx-0 queue:border-0 queue:bg-transparent queue:p-0 queue:backdrop-blur-none">
            <Decisions draft={draft} decision={decision} inboxHref={inboxHref} />
          </div>
        )}
      </div>
    </li>
  );
}

const STATUS_LABELS: Record<string, string> = {
  sent: "Enviado",
  discarded: "Descartado",
  superseded: "Reemplazado: el lead volvió a escribir",
  regenerated: "Se pidió otra versión",
};

function DecidedSummary({ draft }: { draft: DraftQueueRow }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{STATUS_LABELS[draft.status] ?? draft.status}</p>
      {draft.status === "sent" && draft.sentBody && (
        <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/60 px-3 py-2 text-sm">
          {draft.sentBody}
          {draft.body && draft.sentBody !== draft.body && <span className="ml-1 text-[11px] text-muted-foreground">(editado)</span>}
        </p>
      )}
      {draft.status !== "sent" && draft.body && <p className="line-clamp-3 text-sm text-muted-foreground">{draft.body}</p>}
      {draft.discardReason && !draft.discardReason.startsWith("auto:") && (
        <p className="text-[11px] text-muted-foreground">Motivo: {draft.discardReason}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// En la conversacion
// ---------------------------------------------------------------------------

export function ThreadDraft({ draft, onDone }: { draft: DraftQueueRow; onDone: () => void }) {
  const decision = useDraftDecision(draft, onDone);
  return (
    <section
      tabIndex={0}
      onKeyDown={onShortcut(decision)}
      aria-label="Borrador del agente, no enviado"
      className="mx-auto max-w-2xl space-y-2 rounded-xl border-2 border-dashed border-amber-400/70 bg-amber-50/40 p-3 outline-none focus-within:ring-2 focus-within:ring-ring dark:bg-amber-950/10"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
          <Bot className="h-3.5 w-3.5" aria-hidden /> Borrador del agente · no enviado
        </span>
        <span className="text-[11px] text-muted-foreground">
          Responde a {draft.burst.length || 1} {draft.burst.length === 1 ? "mensaje" : "mensajes"} · {timeAgo(draft.createdAt)}
        </span>
        <WindowBadge info={draft.window} />
      </div>
      <ProposedReply draft={draft} decision={decision} />
      <AgentActions draft={draft} />
      <Decisions draft={draft} decision={decision} inboxHref={null} />
      {!decision.canSend && draft.status !== "sending" && (
        <p className="text-xs text-muted-foreground">
          {decision.closed
            ? "Pasó la ventana para responder: si hace falta, escribí a mano en el campo de abajo."
            : "No hay respuesta propuesta: escribí vos en el campo de abajo."}
        </p>
      )}
      <Feedback draft={draft} decision={decision} />
    </section>
  );
}
