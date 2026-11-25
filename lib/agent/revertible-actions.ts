import type { AuditAction } from "@/lib/types/database";

/**
 * Las acciones del agente que se pueden deshacer desde la pestaña Acciones. Vive aparte de `revert.ts` porque la
 * pantalla (un componente del navegador, vía `actions-query.ts`) la necesita y `revert.ts` llega a `lib/audit.ts` →
 * `lib/request-identity.ts` (`node:async_hooks`), que no puede ir al navegador. Así se rompió el build de RER (#109).
 */
export const REVERTIBLE_ACTIONS: AuditAction[] = ["tag", "temperature", "followup", "summary", "assign", "human_takeover", "agent_paused", "update", "setter_status", "qualification"];
