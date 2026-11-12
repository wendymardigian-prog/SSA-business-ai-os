/**
 * Aprobar, editar o descartar una propuesta del analizador (Servicios A4, F143 y F144). El núcleo: las dependencias se
 * inyectan (la base, el envío, las tareas, los avisos) y el test lo corre con espías.
 *
 * Una sola vez: primero `call_proposal_claim` (pending|failed → executing, con la reunión bloqueada); si dos personas
 * aprueban a la vez, gana una y la otra recibe «Ya la resolvió otra persona». Después se ejecuta y queda `done` (con el
 * id de lo creado) o `failed` (con el motivo en palabras; se puede reintentar o descartar).
 *
 * Nada sale solo: esto lo llama SOLO una persona desde la reunión.
 */
import {
  effectiveProposal,
  proposalDiff,
  readProposals,
  type Proposal,
  type ProposalOriginal,
  type ProposalResult,
  type ProposalType,
} from "./proposals";

export type ProposalDecision = "approve" | "discard";

/** A dónde va un mensaje: el chat de WhatsApp del contacto o un grupo. */
export type MessageDestination = { kind: "conversation"; id: string } | { kind: "group"; id: string };

export type ResolveCall = {
  id: string;
  workspaceId: string;
  contactId: string | null;
  serviceId: string | null;
  recordedBy: string | null;
  proposals: unknown;
};

export type StepOutcome = { ok: true; id: string } | { ok: false; reason: string };

export interface ResolveDeps {
  loadCall(callId: string): Promise<ResolveCall | null>;
  can(key: string): boolean;
  claim(callId: string, proposalId: string): Promise<boolean>;
  patch(callId: string, proposalId: string, patch: Partial<Proposal>): Promise<void>;
  serviceOwner(serviceId: string): Promise<string | null>;
  createTask(input: { title: string; description: string; dueInDays: number | null; ownerId: string | null; contactId: string | null; serviceId: string | null; callId: string }): Promise<StepOutcome>;
  /** Completa el paso pendiente con esa clave en el servicio (respeta bloqueo y evidencia: SV033 / SV034). */
  completeStep(serviceId: string, itemKey: string): Promise<StepOutcome>;
  /** Manda el mensaje por el envío de la bandeja (de a uno). `retryOf` = el mensaje fallido de un intento anterior. */
  sendMessage(input: { destination: MessageDestination; text: string; retryOf: string | null }): Promise<StepOutcome & { messageId?: string | null }>;
  notify(input: { recipientId: string; title: string; body: string; callId: string }): Promise<StepOutcome>;
  audit(input: { action: "call.proposal_approved" | "call.proposal_edited" | "call.proposal_discarded" | "call.proposal_failed"; callId: string; changes: Record<string, unknown>; metadata: Record<string, unknown> }): Promise<void>;
  now(): Date;
}

export type ResolveInput = {
  callId: string;
  proposalId: string;
  decision: ProposalDecision;
  edits?: Partial<ProposalOriginal> | null;
  destination?: MessageDestination | null;
  actorId: string;
};

export type ResolveOutcome =
  | { ok: true; status: "done" | "discarded"; result: ProposalResult | null }
  | { ok: false; status: "failed"; error: string }
  | { ok: false; status: "rejected"; error: string };

/** La clave de permiso de lo que hace cada tipo (además de `calls.edit`). El mensaje lo mira el envío (por canal). */
export function permissionForType(type: ProposalType): string | null {
  switch (type) {
    case "tarea":
      return "tasks.edit";
    case "paso":
      return "services.items";
    case "mensaje":
    case "aviso":
      return null;
  }
}

export function missingPermissionMessage(type: ProposalType): string {
  return type === "tarea" ? "Para aprobarla necesitás poder editar tareas." : type === "paso" ? "Para aprobarla necesitás poder completar pasos de servicios." : "No tenés permiso para aprobarla.";
}

function cleanEdits(type: ProposalType, edits: Partial<ProposalOriginal> | null | undefined): ProposalOriginal | null {
  if (!edits) return null;
  const out: Partial<ProposalOriginal> = {};
  if (typeof edits.titulo === "string") out.titulo = edits.titulo.trim().slice(0, 200);
  if (typeof edits.detalle === "string") out.detalle = edits.detalle.trim().slice(0, 2000);
  if (type === "tarea") {
    if (edits.vence_en_dias === null || typeof edits.vence_en_dias === "number") out.vence_en_dias = edits.vence_en_dias === null ? null : Math.max(0, Math.min(60, Math.round(edits.vence_en_dias)));
    if (edits.responsable === null || edits.responsable === "servicio" || edits.responsable === "grabo") out.responsable = edits.responsable;
  }
  if (type === "mensaje" && typeof edits.texto === "string") out.texto = edits.texto.trim().slice(0, 1500);
  if (type === "aviso" && (edits.para === "servicio" || edits.para === "grabo")) out.para = edits.para;
  return Object.keys(out).length ? (out as ProposalOriginal) : null;
}

export async function resolveProposal(deps: ResolveDeps, input: ResolveInput): Promise<ResolveOutcome> {
  if (!deps.can("calls.edit")) return { ok: false, status: "rejected", error: "No tenés permiso para resolver propuestas." };
  const call = await deps.loadCall(input.callId);
  if (!call) return { ok: false, status: "rejected", error: "No encontré la reunión." };
  const proposal = readProposals(call.proposals).find((p) => p.id === input.proposalId);
  if (!proposal) return { ok: false, status: "rejected", error: "Esa propuesta ya no existe." };
  if (proposal.status !== "pending" && proposal.status !== "failed") return { ok: false, status: "rejected", error: "Ya la resolvió otra persona." };

  const at = deps.now().toISOString();

  if (input.decision === "discard") {
    if (!(await deps.claim(call.id, proposal.id))) return { ok: false, status: "rejected", error: "Ya la resolvió otra persona." };
    await deps.patch(call.id, proposal.id, { status: "discarded", resolved_by: input.actorId, resolved_at: at, reason: null });
    await deps.audit({ action: "call.proposal_discarded", callId: call.id, changes: {}, metadata: { proposal_id: proposal.id, type: proposal.type } });
    return { ok: true, status: "discarded", result: null };
  }

  const perm = permissionForType(proposal.type);
  if (perm && !deps.can(perm)) return { ok: false, status: "rejected", error: missingPermissionMessage(proposal.type) };
  if (proposal.type === "mensaje" && !input.destination) return { ok: false, status: "rejected", error: "Elegí a dónde mandar el mensaje." };
  if ((proposal.type === "tarea" || proposal.type === "paso" || proposal.type === "mensaje") && !call.contactId) {
    return { ok: false, status: "rejected", error: "La reunión no tiene contacto." };
  }

  const edited = cleanEdits(proposal.type, input.edits) ?? proposal.edited;
  const effective = effectiveProposal({ ...proposal, edited });

  if (!(await deps.claim(call.id, proposal.id))) return { ok: false, status: "rejected", error: "Ya la resolvió otra persona." };

  let outcome: StepOutcome & { messageId?: string | null };
  let result: ProposalResult = {};
  try {
    switch (proposal.type) {
      case "tarea": {
        const ownerId =
          effective.responsable === "servicio"
            ? (call.serviceId ? await deps.serviceOwner(call.serviceId) : null) ?? input.actorId
            : effective.responsable === "grabo"
              ? call.recordedBy ?? input.actorId
              : null;
        outcome = await deps.createTask({
          title: effective.titulo,
          description: effective.detalle,
          dueInDays: effective.vence_en_dias ?? null,
          ownerId,
          contactId: call.contactId,
          serviceId: call.serviceId,
          callId: call.id,
        });
        if (outcome.ok) result = { task_id: outcome.id };
        break;
      }
      case "paso": {
        if (!call.serviceId || !effective.item_key) {
          outcome = { ok: false, reason: "La reunión no tiene un servicio con ese paso." };
          break;
        }
        outcome = await deps.completeStep(call.serviceId, effective.item_key);
        if (outcome.ok) result = { item_id: outcome.id };
        break;
      }
      case "mensaje": {
        outcome = await deps.sendMessage({
          destination: input.destination!,
          text: effective.texto ?? "",
          retryOf: proposal.status === "failed" ? proposal.result?.message_id ?? null : null,
        });
        const messageId = outcome.ok ? outcome.id : outcome.messageId ?? null;
        if (messageId) result = { message_id: messageId };
        break;
      }
      case "aviso": {
        const to = effective.para === "grabo" ? call.recordedBy : call.serviceId ? await deps.serviceOwner(call.serviceId) : call.recordedBy;
        if (!to) {
          outcome = { ok: false, reason: "No hay a quién avisar: la reunión no tiene responsable ni quien la grabó." };
          break;
        }
        outcome = await deps.notify({ recipientId: to, title: effective.titulo, body: effective.detalle, callId: call.id });
        if (outcome.ok) result = { notification_id: outcome.id };
        break;
      }
    }
  } catch (error) {
    outcome = { ok: false, reason: error instanceof Error && error.message ? "No se pudo hacer. Probá de nuevo." : "No se pudo hacer." };
  }

  if (!outcome.ok) {
    await deps.patch(call.id, proposal.id, { status: "failed", reason: outcome.reason, edited, result: Object.keys(result).length ? result : proposal.result, resolved_by: input.actorId, resolved_at: at });
    await deps.audit({ action: "call.proposal_failed", callId: call.id, changes: proposalDiff(proposal.original, edited), metadata: { proposal_id: proposal.id, type: proposal.type, reason: outcome.reason } });
    return { ok: false, status: "failed", error: outcome.reason };
  }
  await deps.patch(call.id, proposal.id, { status: "done", reason: null, edited, result, resolved_by: input.actorId, resolved_at: at });
  const diff = proposalDiff(proposal.original, edited);
  await deps.audit({
    action: Object.keys(diff).length ? "call.proposal_edited" : "call.proposal_approved",
    callId: call.id,
    changes: diff,
    metadata: { proposal_id: proposal.id, type: proposal.type, result },
  });
  return { ok: true, status: "done", result };
}
