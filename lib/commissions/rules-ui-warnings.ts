/**
 * Avisos de una regla en la lista (F57). Puro.
 */
import type { CommissionRole, CommissionRule } from "./types";

export const NO_PERSON_WARNING = "Esta regla no genera comisiones: falta la persona";

/**
 * Una regla de un rol de persona fija sin persona (la que tenía salió del equipo y la base la dejó en blanco):
 * el motor no sabe a quién pagarle y no genera nada. Las archivadas no cuentan (ya no se usan).
 */
export function ruleMissingPerson(role: Pick<CommissionRole, "payee"> | undefined, rule: Pick<CommissionRule, "beneficiary_user_id" | "archived_at">): boolean {
  return role?.payee === "fixed" && !rule.beneficiary_user_id && !rule.archived_at;
}

export const SHADOWED_WARNING = "Nunca se usa: una regla de más arriba se queda con todos los pagos que llegarían acá";
