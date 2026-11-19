"use client";
// @plantilla-quitar(servicios)

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckSquare, ChevronDown, FileText, Lightbulb, ListChecks, Loader2, MessageCircle, Quote } from "lucide-react";
import { loadProposalDestinations, resolveCallProposal } from "@/lib/actions/call-action-proposals";
import {
  DISCARD_REASONS,
  DISCARD_REASON_LABEL,
  PROPOSAL_TYPE_LABEL,
  decideHint,
  effectiveProposal,
  permissionNeeded,
  type DiscardReason,
  type Proposal,
  type ProposalApprovers,
  type ProposalOriginal,
  type ProposalType,
} from "@/lib/calls/proposals-view";
import type { DestinationOption } from "@/lib/calls/proposal-send";
import { cn } from "@/lib/utils";

/**
 * La sección Propuestas del detalle de la reunión (Servicios A4, F143 y F144). Una tarjeta por propuesta pendiente (o
 * fallida, con su motivo y «Reintentar»), con su cita, los campos editables y tres botones. Las resueltas se pliegan
 * (con el motivo, si se descartó). Sin `calls.edit`, o si la decide otra persona («Quién aprueba»), se ven sin botones
 * y con quién la decide. En el teléfono, una debajo de otra y los botones a lo ancho.
 */

const ICON: Record<ProposalType, typeof CheckSquare> = { tarea: CheckSquare, mensaje: MessageCircle, paso: ListChecks, aviso: Bell, idea: Lightbulb, borrador: FileText };

/** Quién mira: para saber si puede decidir cada propuesta (el servidor lo vuelve a comprobar). */
export interface ProposalViewer {
  approvers: ProposalApprovers;
  isAdmin: boolean;
  /** Es el responsable de la reunión (el del servicio o, sin servicio, quien la grabó). */
  isResponsible: boolean;
}
const STATUS_LABEL: Record<string, string> = { done: "Aprobada", discarded: "Descartada", executing: "En curso", failed: "No se pudo hacer", pending: "Pendiente" };

export function CallProposals({
  callId,
  proposals,
  canEdit,
  permissions,
  pendingStepNames,
  viewer,
}: {
  callId: string;
  proposals: Proposal[];
  canEdit: boolean;
  permissions: string[];
  pendingStepNames: Record<string, string>;
  viewer: ProposalViewer;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const open = proposals.filter((p) => p.status === "pending" || p.status === "failed" || p.status === "executing");
  const resolved = proposals.filter((p) => p.status === "done" || p.status === "discarded");
  if (proposals.length === 0) return null;

  return (
    <section aria-labelledby={`proposals-${callId}`} className="space-y-2">
      <h3 id={`proposals-${callId}`} className="text-sm font-semibold">
        Propuestas {open.length > 0 && <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-ink">{open.length}</span>}
      </h3>
      {open.length === 0 && <p className="text-sm text-muted-foreground">No hay propuestas por aprobar.</p>}
      <ul className="space-y-2">
        {open.map((p) => (
          <li key={p.id}>
            <ProposalCard callId={callId} proposal={p} canEdit={canEdit} permissions={permissions} viewer={viewer} stepName={p.original.item_key ? pendingStepNames[p.original.item_key] ?? p.original.item_key : null} />
          </li>
        ))}
      </ul>
      {resolved.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowResolved((v) => !v)} aria-expanded={showResolved} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showResolved && "rotate-180")} aria-hidden /> Resueltas ({resolved.length})
          </button>
          {showResolved && (
            <ul className="mt-2 space-y-1">
              {resolved.map((p) => {
                const e = effectiveProposal(p);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{PROPOSAL_TYPE_LABEL[p.type]}</span> · {e.titulo || e.texto?.slice(0, 60) || "—"}
                    </span>
                    <span className="shrink-0 text-muted-foreground" title={p.discard_note ?? undefined}>
                      {STATUS_LABEL[p.status]}
                      {p.status === "discarded" && p.discard_reason ? ` · ${DISCARD_REASON_LABEL[p.discard_reason] ?? p.discard_reason}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ProposalCard({ callId, proposal, canEdit, permissions, viewer, stepName }: { callId: string; proposal: Proposal; canEdit: boolean; permissions: string[]; viewer: ProposalViewer; stepName: string | null }) {
  const router = useRouter();
  const Icon = ICON[proposal.type];
  const initial = effectiveProposal(proposal);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProposalOriginal>(initial);
  const [destinations, setDestinations] = useState<DestinationOption[] | null>(null);
  const [dest, setDest] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const missing = permissionNeeded(proposal.type, permissions);
  const notMine = decideHint(proposal.type, viewer);
  const canDecide = canEdit && !notMine;
  const isMessage = proposal.type === "mensaje";
  const isContent = proposal.type === "idea" || proposal.type === "borrador";
  const [discarding, setDiscarding] = useState(false);
  const [reason, setReason] = useState<DiscardReason>("no_hace_falta");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!isMessage || !canDecide) return;
    let alive = true;
    void loadProposalDestinations({ callId }).then((r) => {
      if (!alive) return;
      const list = r.ok ? r.data : [];
      setDestinations(list);
      if (list[0]) setDest(`${list[0].kind}:${list[0].id}`);
    });
    return () => {
      alive = false;
    };
  }, [callId, isMessage, canDecide]);

  const act = (decision: "approve" | "discard", withEdits: boolean) => {
    setError(null);
    const [kind, id] = dest.split(":");
    start(async () => {
      const r = await resolveCallProposal({
        callId,
        proposalId: proposal.id,
        decision,
        edits: withEdits ? draft : null,
        destination: isMessage && decision === "approve" && kind && id ? { kind: kind as "conversation" | "group", id } : null,
        ...(decision === "discard" ? { discardReason: reason, discardNote: note.trim() || null } : {}),
      });
      if (!r.ok) setError(r.error);
      setEditing(false);
      if (r.ok) setDiscarding(false);
      router.refresh();
    });
  };

  const field = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
  return (
    <div className={cn("rounded-xl border p-3 text-sm", proposal.status === "failed" ? "border-red-500/40" : "border-border")}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{PROPOSAL_TYPE_LABEL[proposal.type]}</p>
          {editing ? (
            <div className="space-y-2">
              {proposal.type !== "mensaje" && proposal.type !== "paso" && (
                <input aria-label={isContent ? "Gancho" : "Título"} value={draft.titulo} maxLength={200} onChange={(e) => setDraft({ ...draft, titulo: e.target.value })} className={field} />
              )}
              {proposal.type === "idea" && (
                <textarea aria-label="Ángulo" value={draft.detalle} maxLength={2000} rows={3} onChange={(e) => setDraft({ ...draft, detalle: e.target.value })} className={field} />
              )}
              {proposal.type === "borrador" && (
                <textarea aria-label="Guion" value={draft.guion ?? ""} maxLength={6000} rows={8} onChange={(e) => setDraft({ ...draft, guion: e.target.value })} className={field} />
              )}
              {(proposal.type === "tarea" || proposal.type === "aviso") && (
                <textarea aria-label="Detalle" value={draft.detalle} maxLength={2000} rows={2} onChange={(e) => setDraft({ ...draft, detalle: e.target.value })} className={field} />
              )}
              {proposal.type === "tarea" && (
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    Vence en
                    <input type="number" min={0} max={60} value={draft.vence_en_dias ?? ""} onChange={(e) => setDraft({ ...draft, vence_en_dias: e.target.value === "" ? null : Math.max(0, Math.min(60, Number(e.target.value))) })} className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm" />
                    días
                  </label>
                  <select aria-label="Responsable" value={draft.responsable ?? ""} onChange={(e) => setDraft({ ...draft, responsable: (e.target.value || null) as ProposalOriginal["responsable"] })} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                    <option value="">Sin responsable</option>
                    <option value="servicio">El responsable del servicio</option>
                    <option value="grabo">Quien grabó</option>
                  </select>
                </div>
              )}
              {proposal.type === "mensaje" && (
                <textarea aria-label="Texto del mensaje" value={draft.texto ?? ""} maxLength={1500} rows={5} onChange={(e) => setDraft({ ...draft, texto: e.target.value })} className={field} />
              )}
              {proposal.type === "aviso" && (
                <select aria-label="Para" value={draft.para ?? "servicio"} onChange={(e) => setDraft({ ...draft, para: e.target.value as "servicio" | "grabo" })} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                  <option value="servicio">El responsable del servicio</option>
                  <option value="grabo">Quien grabó</option>
                </select>
              )}
            </div>
          ) : (
            <>
              {proposal.type === "paso" ? (
                <p className="font-medium">Completar «{stepName ?? "un paso"}»</p>
              ) : proposal.type === "mensaje" ? (
                <p className="whitespace-pre-wrap">{initial.texto}</p>
              ) : (
                <p className="font-medium">{initial.titulo}</p>
              )}
              {initial.detalle && proposal.type !== "mensaje" && <p className="text-muted-foreground">{initial.detalle}</p>}
              {proposal.type === "borrador" && initial.guion && (
                <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 px-3 py-2">{initial.guion}</p>
              )}
              {isContent && (
                <p className="text-xs text-muted-foreground">
                  {initial.formato ? `${initial.formato} · ` : ""}
                  {proposal.type === "idea" ? "Entra al banco de ideas de Contenido como nueva" : "Crea la pieza en Borrador con el guion"}
                </p>
              )}
              {proposal.type === "tarea" && (
                <p className="text-xs text-muted-foreground">
                  {initial.vence_en_dias === null || initial.vence_en_dias === undefined ? "Sin vencimiento" : `Vence en ${initial.vence_en_dias} día(s)`} ·{" "}
                  {initial.responsable === "servicio" ? "El responsable del servicio" : initial.responsable === "grabo" ? "Quien grabó" : "Sin responsable"}
                </p>
              )}
            </>
          )}
          {isMessage && canEdit && (
            <label className="block text-xs">
              <span className="font-medium">Mandar a</span>
              {destinations === null ? (
                <span className="ml-2 inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Buscando…</span>
              ) : destinations.length === 0 ? (
                <span className="mt-1 block text-amber-700 dark:text-amber-300">No tenés un chat ni un grupo de WhatsApp donde escribirle. Pedí acceso a la cuenta en la bandeja.</span>
              ) : (
                <select value={dest} onChange={(e) => setDest(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {destinations.map((d) => (
                    <option key={`${d.kind}:${d.id}`} value={`${d.kind}:${d.id}`}>{d.label}</option>
                  ))}
                </select>
              )}
            </label>
          )}
          {initial.cita && (
            <p className="flex gap-1 text-xs italic text-muted-foreground">
              <Quote className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span>«{initial.cita}»</span>
            </p>
          )}
          {proposal.status === "failed" && proposal.reason && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{proposal.reason}</p>}
          {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
          {canEdit && notMine && <p className="text-xs text-muted-foreground">{notMine}</p>}
          {canDecide && missing && <p className="text-xs text-muted-foreground">{missing}</p>}
        </div>
      </div>
      {canDecide && discarding && proposal.status !== "executing" && (
        <div className="mt-3 space-y-2 rounded-md border border-border p-2.5">
          <label className="block text-xs">
            <span className="font-medium">¿Por qué la descartás?</span>
            <select value={reason} onChange={(e) => setReason(e.target.value as DiscardReason)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {DISCARD_REASONS.map((r) => (
                <option key={r} value={r}>{DISCARD_REASON_LABEL[r]}</option>
              ))}
            </select>
          </label>
          {reason === "otro" && (
            <textarea aria-label="Motivo" value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="Contá el motivo" className={field} />
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={pending} onClick={() => setDiscarding(false)} className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted max-sm:w-full">
              Volver
            </button>
            <button type="button" disabled={pending || (reason === "otro" && !note.trim())} onClick={() => act("discard", false)} className="h-9 rounded-md border border-red-500/50 px-3 text-sm font-medium text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300 max-sm:w-full">
              {pending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Descartar"}
            </button>
          </div>
        </div>
      )}
      {canDecide && !discarding && proposal.status !== "executing" && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={pending} onClick={() => setDiscarding(true)} className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted max-sm:w-full">
            Descartar
          </button>
          {missing ? null : editing ? (
            <button type="button" disabled={pending || (isMessage && !dest) || (proposal.type === "borrador" && !(draft.guion ?? "").trim()) || (isContent && !draft.titulo.trim())} onClick={() => act("approve", true)} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 max-sm:w-full">
              {pending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Guardar y aprobar"}
            </button>
          ) : (
            <>
              <button type="button" disabled={pending} onClick={() => setEditing(true)} className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted max-sm:w-full">
                Editar y aprobar
              </button>
              <button type="button" disabled={pending || (isMessage && !dest)} onClick={() => act("approve", false)} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 max-sm:w-full">
                {pending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : proposal.status === "failed" ? "Reintentar" : "Aprobar"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
