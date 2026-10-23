/**
 * El responsable de una conversacion en la bandeja: quien puede cambiarlo y
 * que opciones ve en el selector. Puro: lo usan la cabecera del chat y la
 * Server Action (`setConversationAssignee`).
 */

export interface AssigneeChangeInput {
  /** Tiene `contacts.assign`: puede asignar a cualquiera o sacar al responsable. */
  canAssign: boolean;
  /** Puede responder en la cuenta de la conversacion. */
  canReply: boolean;
  viewerId: string;
  current: string | null;
  next: string | null;
}

/**
 * Con `contacts.assign`, cualquier cambio. Sin la clave, solo "Tomarla": una
 * conversacion SIN responsable, para uno mismo, en una cuenta donde responde.
 */
export function canChangeConversationAssignee(input: AssigneeChangeInput): boolean {
  if (input.canAssign) return true;
  return input.canReply && input.current === null && input.next === input.viewerId;
}

export type AssigneeControl =
  /** Selector con todo el equipo. */
  | { kind: "select" }
  /** Sin la clave y sin responsable: un boton "Tomar". */
  | { kind: "take" }
  /** Solo se muestra quien es (o "Sin responsable"). */
  | { kind: "readonly" };

export function assigneeControl(input: Omit<AssigneeChangeInput, "next">): AssigneeControl {
  if (input.canAssign) return { kind: "select" };
  if (input.canReply && input.current === null) return { kind: "take" };
  return { kind: "readonly" };
}

export interface TeamMember {
  userId: string;
  label: string;
}

/**
 * Las opciones del selector. Una persona que ya no esta en el equipo sigue
 * viendose como responsable actual (sin inventarle un nombre), en vez de dejar
 * el selector en blanco.
 */
export function assigneeOptions(members: TeamMember[], current: string | null): TeamMember[] {
  if (!current || members.some((m) => m.userId === current)) return members;
  return [...members, { userId: current, label: "Alguien que ya no está en el equipo" }];
}

/** El nombre del responsable, o null si no tiene (o si ya no esta en el equipo). */
export function assigneeName(members: TeamMember[], current: string | null | undefined): string | null {
  if (!current) return null;
  return members.find((m) => m.userId === current)?.label ?? null;
}
