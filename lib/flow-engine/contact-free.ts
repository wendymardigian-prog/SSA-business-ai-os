/**
 * Lo que el NAVEGADOR necesita saber de los flujos sin contacto (E15): qué disparadores
 * son sobre una persona del equipo y qué pasos sirven sin contacto. Puro y sin importar el
 * registro (que trae código de servidor). `registry/consistency.test.ts` exige que estas
 * listas digan lo mismo que el registro.
 */
export const MEMBER_TRIGGER_TYPES = ["eod_submitted"] as const;

export const CONTACT_FREE_NODE_TYPES = ["abSplit", "branch", "delay", "goToFlow", "httpRequest", "notify_team", "send_email"] as const;

export function isMemberTriggerType(type: unknown): boolean {
  return typeof type === "string" && (MEMBER_TRIGGER_TYPES as readonly string[]).includes(type);
}

export function isContactFreeNodeType(type: string): boolean {
  return (CONTACT_FREE_NODE_TYPES as readonly string[]).includes(type);
}
