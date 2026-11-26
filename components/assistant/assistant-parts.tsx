"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clock, Loader2, Play, X } from "lucide-react";
import type { PanelMessage, PanelStep } from "@/lib/assistant/actor";
import { approveProposal, rejectProposal } from "@/lib/actions/ai-proposals";
import { REJECT_REASONS, REJECT_REASON_LABELS, type RejectReason } from "@/lib/ai-learning/reject-reasons";

/**
 * Las piezas del asistente que comparten el panel acoplado y la pantalla completa: el plan (lo que
 * se propone hacer), los pasos (lo que pasó de verdad: cada consulta plegada, cada escritura con sus parámetros para
 * aprobarla o rechazarla) y el estado de la respuesta.
 */

export function MessageBubble({
  message,
  onDecided,
  onResume,
  resuming = false,
  compact = false,
  variant = "dock",
}: {
  message: PanelMessage;
  onDecided: () => Promise<void>;
  onResume?: (messageId: string) => void;
  resuming?: boolean;
  compact?: boolean;
  /** "full": la pantalla completa, con los pasos en tarjeta y la aprobación con su título. */
  variant?: StepVariant;
}) {
  if (message.role === "user") {
    return <p className={`ml-auto w-fit ${compact ? "max-w-[85%]" : "max-w-[80%]"} whitespace-pre-wrap rounded-[10px] bg-primary/10 px-3 py-2 text-sm text-foreground ring-1 ring-inset ring-primary-edge/70`}>{message.content}</p>;
  }
  const working = message.phase === "running";
  return (
    <div className={`${compact ? "mr-4" : variant === "full" ? "" : "max-w-[90%]"} ${variant === "full" ? "space-y-2.5" : "space-y-2"}`}>
      {message.plan.length > 0 && <PlanList plan={message.plan} />}
      {message.steps.some((s) => s.access !== "write") && <StepList message={message} onDecided={onDecided} only="read" variant={variant} />}
      {working && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Trabajando… (si cierras la pestaña, sigue y lo ves al volver)
        </p>
      )}
      {message.phase === "stalled" && <p className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-100">Esta respuesta se cortó a mitad. Puedes seguir desde el último paso guardado.</p>}
      {message.content && <p className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${message.error ? "border border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100" : "border border-border"}`}>{message.content}</p>}
      {message.steps.some((s) => s.access === "write") && <StepList message={message} onDecided={onDecided} only="write" variant={variant} />}
      {message.canResume && onResume && (
        <button type="button" disabled={resuming} onClick={() => onResume(message.id)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">
          {resuming ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          Seguir desde donde lo dejó
        </button>
      )}
    </div>
  );
}

export function PlanList({ plan }: { plan: string[] }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <p className="mb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Plan</p>
      <ol className="space-y-1 text-[13px]">
        {plan.map((p, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px] text-muted-foreground ring-1 ring-inset ring-border">{i + 1}</span>
            <span>{p}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export type StepVariant = "dock" | "full";

export function StepList({ message, onDecided, only, variant = "dock" }: { message: PanelMessage; onDecided: () => Promise<void>; only?: "read" | "write"; variant?: StepVariant }) {
  return (
    <ol className={variant === "full" ? "space-y-2.5" : "space-y-1"} aria-label={only === "write" ? "Lo que quiere hacer" : "Pasos"}>
      {message.steps.map((s, i) =>
        only && (only === "write") !== (s.access === "write") ? null : (
          <li key={`${message.id}-${i}`}>
            <StepItem step={s} onDecided={onDecided} variant={variant} />
          </li>
        ),
      )}
    </ol>
  );
}

export function StepItem({ step, onDecided, variant = "dock" }: { step: PanelStep; onDecided: () => Promise<void>; variant?: StepVariant }) {
  if (step.access === "write") return <ProposalCard step={step} onDecided={onDecided} variant={variant} />;
  if (variant === "full") {
    // Tarjeta de 40 px con el resultado en un cuadrado verde (o rojo si no tuvo acceso), «Lectura» y la flecha.
    return (
      <details className="group rounded-lg border border-border text-sm">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-3 px-3 py-1.5">
          <span className={`flex size-4 shrink-0 items-center justify-center rounded-full text-white ${step.ok ? "bg-green-600" : "bg-red-600"}`}>
            {step.ok ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {step.label}
            {!step.ok && <span className="text-red-700 dark:text-red-300"> · sin acceso</span>}
          </span>
          <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">Lectura</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-1.5 border-t border-border px-3 py-2.5">
          <p className="text-sm text-muted-foreground">{step.message}</p>
          {step.output !== undefined && step.output !== null && <pre className="max-h-60 overflow-auto rounded bg-muted p-2 font-mono text-[11px] leading-snug">{JSON.stringify(step.output, null, 2)}</pre>}
        </div>
      </details>
    );
  }
  return (
    <details className="group rounded-md border border-border text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-muted-foreground">
        <ChevronRight className="size-3.5 transition group-open:rotate-90" aria-hidden />
        <span>
          Consultó: <span className="font-medium text-foreground">{step.label}</span>
        </span>
        {!step.ok && <span className="ml-auto text-red-700 dark:text-red-300">sin acceso</span>}
      </summary>
      <div className="space-y-1 border-t border-border px-2 py-2">
        <p className="text-muted-foreground">{step.message}</p>
        {step.output !== undefined && step.output !== null && <pre className="max-h-60 overflow-auto rounded bg-muted p-2 text-[11px] leading-snug">{JSON.stringify(step.output, null, 2)}</pre>}
      </div>
    </details>
  );
}

const PHASE_TEXT: Record<string, { text: string; cls: string }> = {
  approved: { text: "Aprobada y hecha", cls: "text-green-700 dark:text-green-300" },
  rejected: { text: "Descartada", cls: "text-red-700 dark:text-red-300" },
  failed: { text: "Falló al hacerse", cls: "text-red-700 dark:text-red-300" },
  expired: { text: "Caducada", cls: "text-yellow-700 dark:text-yellow-300" },
  pending: { text: "Espera tu aprobación", cls: "text-yellow-700 dark:text-yellow-300" },
};

/** Los parámetros de la acción propuesta, en claro (la persona ve exactamente qué se va a hacer). */
function ProposalParams({ input, variant = "dock" }: { input: unknown; variant?: StepVariant }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const entries = Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return null;
  if (variant === "full") {
    // Rótulo en una columna fija y el valor en monoespaciada, sin separadores.
    return (
      <dl className="mt-3 grid grid-cols-[minmax(0,100px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate text-foreground first-letter:uppercase">{k.replace(/_/g, " ")}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words font-mono text-foreground">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className="mt-2 divide-y divide-border/70 border-y border-border/70">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px]">
          <dt className="shrink-0 text-muted-foreground">{k.replace(/_/g, " ")}</dt>
          <dd className="min-w-0 break-words text-right text-foreground">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProposalCard({ step, onDecided, variant = "dock" }: { step: PanelStep; onDecided: () => Promise<void>; variant?: StepVariant }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectReason>("other");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const phase = step.proposal?.phase ?? (step.proposal_id ? "pending" : null);
  const label = step.proposal?.label ?? step.label;

  if (!step.proposal_id) {
    return <p className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground">No pude proponer «{step.label}»: {step.message}</p>;
  }
  const decide = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok ? null : (r.message ?? "No se pudo."));
      if (r.ok) {
        setRejecting(false);
        await onDecided();
      }
    });
  const state = PHASE_TEXT[phase ?? "pending"];
  const full = variant === "full";
  return (
    <div className={`border text-xs ${full ? "rounded-xl p-4" : "rounded-lg p-3"} ${phase === "pending" ? (full ? "border-primary-edge bg-primary/10" : "border-primary-edge/70 bg-primary/10") : "border-border"}`}>
      {full ? (
        // Reloj en cuadrado, «Esperando tu aprobación» (o cómo terminó) e insignia «Escritura»; la acción, debajo.
        <>
          <div className="flex items-center gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full text-foreground ring-1 ring-inset ring-border">
              <Clock className="size-3.5" aria-hidden />
            </span>
            <p className={`min-w-0 flex-1 text-sm font-semibold ${phase === "pending" ? "text-foreground" : state.cls}`}>{phase === "pending" ? "Esperando tu aprobación" : state.text}</p>
            <span className="shrink-0 rounded-md bg-primary/15 px-2 py-0.5 text-xs text-primary-ink">Escritura</span>
          </div>
          <p className="mt-2 text-sm text-foreground">{label}</p>
        </>
      ) : (
        <p className="flex items-start gap-1.5 text-[13px] font-semibold text-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span>Quiere: {label}</span>
        </p>
      )}
      <ProposalParams input={step.input} variant={variant} />
      {!full && phase !== "pending" && <p className={`mt-1 ${state.cls}`}>{state.text}</p>}
      {phase === "pending" && !rejecting && (
        <div className={`mt-3 flex ${full ? "gap-1" : "gap-2"}`}>
          <button type="button" disabled={pending} onClick={() => decide(() => approveProposal(step.proposal_id!))} className={`inline-flex h-9 items-center gap-1 rounded-md bg-primary text-primary-foreground disabled:opacity-50 ${full ? "px-4 text-sm font-semibold" : "px-3.5 text-[13px] font-medium"}`}>
            {!full && <Check className="size-3.5" aria-hidden />} Aprobar
          </button>
          <button type="button" disabled={pending} onClick={() => setRejecting(true)} className={full ? "h-9 rounded-md px-3 text-sm text-foreground hover:text-foreground disabled:opacity-50" : "h-9 rounded-md border border-border px-3.5 text-[13px] hover:bg-muted disabled:opacity-50"}>
            Descartar
          </button>
        </div>
      )}
      {phase === "pending" && rejecting && (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className="text-muted-foreground">Motivo</span>
            <select value={reason} onChange={(e) => setReason(e.target.value as RejectReason)} className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1">
              {REJECT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REJECT_REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-muted-foreground">Nota (opcional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1" />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => decide(() => rejectProposal(step.proposal_id!, { reason, note: note.trim() || null }))} className="rounded-md bg-red-700 px-2.5 py-1 text-white disabled:opacity-50">
              Descartar
            </button>
            <button type="button" disabled={pending} onClick={() => setRejecting(false)} className="rounded-md border border-border px-2.5 py-1 hover:bg-muted">
              Volver
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p role="alert" className="mt-1 text-destructive">
          {msg}
        </p>
      )}
    </div>
  );
}
