/**
 * Lo que necesita la pantalla de las propuestas (Servicios A4, F143). PURO y sin nada de servidor: lo importa el
 * componente de cliente.
 */
import { missingPermissionMessage, permissionForType } from "./proposals-resolve";
import type { ProposalType } from "./proposals";

export { PROPOSAL_TYPE_LABEL, effectiveProposal } from "./proposals";
export type { Proposal, ProposalOriginal, ProposalType } from "./proposals";

/** El permiso que falta para aprobar ese tipo (además de `calls.edit`), en palabras, o null si no falta nada. */
export function permissionNeeded(type: ProposalType, permissions: readonly string[]): string | null {
  const key = permissionForType(type);
  if (!key || permissions.includes(key)) return null;
  return missingPermissionMessage(type);
}
