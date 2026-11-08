/**
 * Reglas para configurar y crear grupos de WhatsApp desde el sistema (00344). Modulo PURO: lo usan las acciones del
 * servidor y la pantalla, asi las dos validan igual.
 *
 * Lo que WhatsApp deja hacer por Evolution: crear un grupo, cambiar nombre, descripcion y foto, los permisos (quien
 * envia y quien edita la info), los miembros (agregar, sacar, hacer o quitar admin), el link de invitacion y salir.
 * Crear una comunidad o meter un grupo en una comunidad NO: eso se hace desde el celular.
 */

import { normalizePhone } from "@/lib/phone";
import type { GroupParticipantAction, GroupSettingAction } from "@/lib/evolution-client";

/** Los topes de WhatsApp. */
export const GROUP_SUBJECT_MAX = 100;
export const GROUP_DESCRIPTION_MAX = 2048;
/** Cuantas personas se agregan o se sacan de una vez (WhatsApp corta las tandas grandes). */
export const GROUP_PARTICIPANTS_MAX = 50;

export interface ManagedParticipant {
  /** Lo que se le pasa a WhatsApp para sacarlo o cambiarle el rol: telefono o @lid. */
  key: string;
  label: string;
  phone: string | null;
  admin: boolean;
  isNumber: boolean;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateGroupSubject(raw: unknown): Validated<string> {
  const subject = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!subject) return { ok: false, error: "El grupo necesita un nombre." };
  if (subject.length > GROUP_SUBJECT_MAX) return { ok: false, error: `El nombre puede tener hasta ${GROUP_SUBJECT_MAX} caracteres.` };
  return { ok: true, value: subject };
}

export function validateGroupDescription(raw: unknown): Validated<string> {
  const description = typeof raw === "string" ? raw.trim() : "";
  if (description.length > GROUP_DESCRIPTION_MAX) {
    return { ok: false, error: `La descripción puede tener hasta ${GROUP_DESCRIPTION_MAX} caracteres.` };
  }
  return { ok: true, value: description };
}

/**
 * Una lista de telefonos escrita a mano (separados por coma, punto y coma o renglon) o ya en un array. Devuelve los
 * validos normalizados ("+549..."), sin repetir, y los que no se entendieron, para decirlos.
 */
export function parsePhoneList(raw: unknown): { phones: string[]; invalid: string[] } {
  const parts = Array.isArray(raw) ? raw.map((p) => String(p ?? "")) : typeof raw === "string" ? raw.split(/[\n,;]+/) : [];
  const phones: string[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (!text) continue;
    const phone = normalizePhone(text);
    if (!phone) invalid.push(text.slice(0, 40));
    else if (!phones.includes(phone)) phones.push(phone);
  }
  return { phones, invalid };
}

export function validateParticipantAction(raw: unknown): GroupParticipantAction | null {
  return raw === "add" || raw === "remove" || raw === "promote" || raw === "demote" ? raw : null;
}

/** Los cambios de permisos a pedirle a WhatsApp, solo los que cambian. */
export function settingActions(
  current: { announce: boolean; restrict: boolean },
  next: { announce?: boolean; restrict?: boolean },
): GroupSettingAction[] {
  const actions: GroupSettingAction[] = [];
  if (typeof next.announce === "boolean" && next.announce !== current.announce) actions.push(next.announce ? "announcement" : "not_announcement");
  if (typeof next.restrict === "boolean" && next.restrict !== current.restrict) actions.push(next.restrict ? "locked" : "unlocked");
  return actions;
}

/** El mensaje por privado para quien WhatsApp no deja agregar. */
export function inviteMessage(subject: string, link: string): string {
  return `¡Hola! Te invito a sumarte al grupo «${subject}» de WhatsApp: ${link}`;
}

/** Que decirle a la persona despues de agregar o sacar miembros. */
export function participantsSummary(
  action: GroupParticipantAction,
  results: ReadonlyArray<{ status: "ok" | "needs_invite" | "failed" }>,
): string {
  const ok = results.filter((r) => r.status === "ok").length;
  const invite = results.filter((r) => r.status === "needs_invite").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const done: Record<GroupParticipantAction, [string, string]> = {
    add: ["agregada", "agregadas"],
    remove: ["sacada del grupo", "sacadas del grupo"],
    promote: ["ahora es admin", "ahora son admins"],
    demote: ["ya no es admin", "ya no son admins"],
  };
  const parts: string[] = [];
  if (ok > 0) parts.push(ok === 1 ? `1 persona ${done[action][0]}` : `${ok} personas ${done[action][1]}`);
  if (invite > 0) parts.push(invite === 1 ? "1 no se pudo agregar por su privacidad: mandale el link" : `${invite} no se pudieron agregar por su privacidad: mandales el link`);
  if (failed > 0) parts.push(failed === 1 ? "1 no se pudo (puede que no tenga WhatsApp o ya esté)" : `${failed} no se pudieron (puede que no tengan WhatsApp o ya estén)`);
  return parts.length > 0 ? `${parts.join(". ")}.` : "WhatsApp no informó ningún cambio.";
}
