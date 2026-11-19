"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Inbox, Pencil, X } from "lucide-react";
import { approveProposal, rejectProposal } from "@/lib/actions/ai-proposals";
import { REJECT_REASONS, REJECT_REASON_LABELS, type RejectReason } from "@/lib/ai-learning/reject-reasons";
import { PROPOSAL_STATUS_LABELS, type ProposalField, type ProposalScreenRow } from "@/lib/ai-proposals/types";
import { formatDateTime } from "@/components/contacts/ui";
import { cn } from "@/lib/utils";

/**
 * Bandeja de aprobación. Cada propuesta, una por una: aprobar tal cual, editar y aprobar, o
 * rechazar con un motivo de la lista cerrada («otro» con nota). La regla vive en el servidor; la pantalla solo la
 * compone.
 */
export function ApprovalsView({ pending, decided, timeZone }: { pending: ProposalScreenRow[]; decided: ProposalScreenRow[]; timeZone: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section aria-labelledby="pendientes">
        <h2 id="pendientes" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pendientes {pending.length > 0 ? `(${pending.length})` : ""}
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
            <p className="mt-3 text-sm font-medium">No hay nada para aprobar</p>
            <p className="mt-1 text-sm text-muted-foreground">Cuando un agente proponga una acción, aparecerá aquí. Nada se aplica sin que una persona lo apruebe.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((row) => (
              <li key={row.id}>
                <ProposalCard row={row} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <section aria-labelledby="decididas">
          <h2 id="decididas" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Decididas hace poco
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {decided.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.agentName ?? "Agente"}
                    {row.decidedByName ? ` · ${row.decidedByName}` : ""}
                    {row.decidedAt ? ` · ${formatDateTime(row.decidedAt, timeZone)}` : ""}
                    {row.rejectReason ? ` · ${REJECT_REASON_LABELS[row.rejectReason as RejectReason] ?? row.rejectReason}` : ""}
                    {row.rejectNote ? `: ${row.rejectNote}` : ""}
                  </p>
                </div>
                <StatusBadge status={row.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "approved" || status === "approved_edited"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
      : status === "rejected" || status === "failed"
        ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  return <span className={cn("inline-flex w-fit shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", tone)}>{PROPOSAL_STATUS_LABELS[status] ?? status}</span>;
}

function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ProposalCard({ row, timeZone }: { row: ProposalScreenRow; timeZone: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "editing" | "rejecting">("idle");
  const [values, setValues] = useState<Record<string, unknown>>(row.params);
  const [reason, setReason] = useState<RejectReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function approve(edited: boolean) {
    setError(null);
    start(async () => {
      const result = await approveProposal(row.id, edited ? values : null);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }
  function reject() {
    setError(null);
    if (!reason) return setError("Elegí un motivo de la lista.");
    if (reason === "other" && !note.trim()) return setError("Con «Otro», escribí una nota con el motivo.");
    start(async () => {
      const result = await rejectProposal(row.id, { reason, note: note.trim() || null });
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  const entries = Object.entries(row.params);
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{row.label}</h3>
          <p className="text-xs text-muted-foreground">
            {row.agentName ?? "Asistente"}
            {row.requestedByName ? ` · pedido por ${row.requestedByName}` : ""} · {formatDateTime(row.createdAt, timeZone)}
            {row.conversationId && (
              <>
                {" · "}
                <Link href={`/dashboard/inbox?c=${row.conversationId}`} className="underline underline-offset-2">
                  Ver la conversación
                </Link>
              </>
            )}
          </p>
        </div>
        <StatusBadge status={row.status} />
      </header>

      {row.summary && <p className="mt-2 text-sm">{row.summary}</p>}

      {mode === "editing" ? (
        <div className="mt-3 space-y-3">
          {row.fields.length === 0 && <p className="text-xs text-muted-foreground">Esta acción no tiene campos para editar: apruébala o recházala.</p>}
          {row.fields.map((field) => (
            <FieldEditor key={field.key} field={field} id={`${row.id}-${field.key}`} value={values[field.key]} onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))} />
          ))}
        </div>
      ) : (
        entries.length > 0 && (
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            {entries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-xs text-muted-foreground">{row.fields.find((f) => f.key === key)?.label ?? key}</dt>
                <dd className="break-words">{valueText(value)}</dd>
              </div>
            ))}
          </dl>
        )
      )}

      {mode === "rejecting" && (
        <div className="mt-3 space-y-2">
          <label htmlFor={`${row.id}-reason`} className="block text-xs font-medium">
            Motivo del rechazo
          </label>
          <select
            id={`${row.id}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value as RejectReason | "")}
            className="min-h-11 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Elegí un motivo</option>
            {REJECT_REASONS.map((key) => (
              <option key={key} value={key}>
                {REJECT_REASON_LABELS[key]}
              </option>
            ))}
          </select>
          <label htmlFor={`${row.id}-note`} className="block text-xs font-medium">
            {reason === "other" ? "Nota (obligatoria)" : "Nota (opcional)"}
          </label>
          <textarea
            id={`${row.id}-note`}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {row.canDecide ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {mode === "idle" && (
            <>
              <ActionButton tone="primary" onClick={() => approve(false)} disabled={pending}>
                <Check className="h-4 w-4" aria-hidden /> Aprobar
              </ActionButton>
              <ActionButton onClick={() => setMode("editing")} disabled={pending}>
                <Pencil className="h-4 w-4" aria-hidden /> Editar
              </ActionButton>
              <ActionButton tone="danger" onClick={() => setMode("rejecting")} disabled={pending}>
                <X className="h-4 w-4" aria-hidden /> Rechazar
              </ActionButton>
            </>
          )}
          {mode === "editing" && (
            <>
              <ActionButton tone="primary" onClick={() => approve(true)} disabled={pending}>
                <Check className="h-4 w-4" aria-hidden /> Aprobar con mi edición
              </ActionButton>
              <ActionButton onClick={() => { setValues(row.params); setMode("idle"); }} disabled={pending}>
                Cancelar
              </ActionButton>
            </>
          )}
          {mode === "rejecting" && (
            <>
              <ActionButton tone="danger" onClick={reject} disabled={pending}>
                <X className="h-4 w-4" aria-hidden /> Rechazar
              </ActionButton>
              <ActionButton onClick={() => setMode("idle")} disabled={pending}>
                Cancelar
              </ActionButton>
            </>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          {row.executor === "person_tool" ? "La aprueba la persona que se la pidió al asistente." : "Tu rol no puede hacer esta acción, así que tampoco aprobarla."}
        </p>
      )}
    </article>
  );
}

function FieldEditor({ field, id, value, onChange }: { field: ProposalField; id: string; value: unknown; onChange: (v: unknown) => void }) {
  const className = "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium">
        {field.label}
      </label>
      {field.kind === "textarea" ? (
        <textarea id={id} rows={3} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={className} />
      ) : field.kind === "list" ? (
        <input
          id={id}
          value={Array.isArray(value) ? value.join(", ") : ""}
          onChange={(e) => onChange(e.target.value.split(",").map((v) => v.trim()).filter(Boolean))}
          className={className}
        />
      ) : field.kind === "select" ? (
        <select id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={className}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} type={field.kind === "date" ? "date" : "text"} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} className={className} />
      )}
    </div>
  );
}

function ActionButton({ tone, children, ...props }: { tone?: "primary" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-50 sm:min-h-9",
        tone === "primary" && "bg-primary text-primary-foreground hover:opacity-90",
        tone === "danger" && "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40",
        !tone && "border border-border hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
