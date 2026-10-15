/**
 * Lo que el NAVEGADOR necesita saber de los flujos sin contacto (E15): qué disparadores
 * son sobre una persona del equipo y qué pasos sirven sin contacto. Puro y sin importar el
 * registro (que trae código de servidor). `registry/consistency.test.ts` exige que estas
 * listas digan lo mismo que el registro.
 */
export const MEMBER_TRIGGER_TYPES = ["eod_submitted"] as const;

/**
 * Los disparadores de SISTEMA (Tirón 2, D1): sin contacto ni persona. Todavía no hay ninguno registrado; la lista
 * existe para que el primero que se sume (y `registry/consistency.test.ts`) no dependa de tocar el navegador a ciegas.
 */
export const SYSTEM_TRIGGER_TYPES: readonly string[] = [];

export const CONTACT_FREE_NODE_TYPES = ["abSplit", "branch", "complete_task", "create_task", "delay", "goToFlow", "httpRequest", "notify_team", "send_email", "send_whatsapp_number", "upsert_contact"] as const;

export function isMemberTriggerType(type: unknown): boolean {
  return typeof type === "string" && (MEMBER_TRIGGER_TYPES as readonly string[]).includes(type);
}

/** ¿El flujo de este disparador nunca tiene contacto? (de una persona del equipo o de sistema): la paleta solo ofrece pasos que sirvan sin uno. */
export function isNoContactTriggerType(type: unknown): boolean {
  return typeof type === "string" && (isMemberTriggerType(type) || SYSTEM_TRIGGER_TYPES.includes(type));
}

export function isContactFreeNodeType(type: string): boolean {
  return (CONTACT_FREE_NODE_TYPES as readonly string[]).includes(type);
}
