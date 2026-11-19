/**
 * Lo que necesita la pantalla de las propuestas (Servicios A4, F143). PURO y sin nada de servidor: lo importa el
 * componente de cliente.
 */
import { approverHint, missingPermissionMessage, permissionsForType } from "./proposals-resolve";
import { canDecideProposal, type ProposalApprovers, type ProposalType } from "./proposals";

export { APPROVER_LABEL, DISCARD_REASONS, DISCARD_REASON_LABEL, PROPOSAL_TYPE_LABEL, effectiveProposal } from "./proposals";
export type { DiscardReason, Proposal, ProposalApprovers, ProposalOriginal, ProposalType } from "./proposals";

/** El permiso que falta para aprobar ese tipo (además de `calls.edit`), en palabras, o null si no falta nada. */
export function permissionNeeded(type: ProposalType, permissions: readonly string[]): string | null {
  return permissionsForType(type).every((k) => permissions.includes(k)) ? null : missingPermissionMessage(type);
}

/** Si quien mira puede decidir esa propuesta (aprobar o descartar). Si no, el texto de quién la decide. */
export function decideHint(type: ProposalType, viewer: { approvers: ProposalApprovers; isAdmin: boolean; isResponsible: boolean }): string | null {
  return canDecideProposal({ approver: viewer.approvers[type], isAdmin: viewer.isAdmin, isResponsible: viewer.isResponsible }) ? null : approverHint(type, viewer.approvers);
}
