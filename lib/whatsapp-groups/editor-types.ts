/**
 * Lo que el editor de automatizaciones recibe de los grupos (tipos compartidos: en un archivo `"use server"` solo
 * pueden exportarse funciones asincronicas).
 */

export interface EditorGroup {
  id: string;
  subject: string;
  channelLabel: string;
  inInbox: boolean;
  saveContacts: boolean;
  /** 00344: 'group' o 'announce' (el de Avisos de una comunidad). */
  kind?: string;
  /** La comunidad del grupo, si es de una. */
  communitySubject?: string | null;
}

export interface EditorGroupMessage {
  id: string;
  groupId: string;
  /** El texto (o la pregunta, si es una encuesta), recortado. */
  label: string;
  fromBusiness: boolean;
  /** Solo encuestas. */
  options: string[] | null;
  createdAt: string;
}

export interface EditorPollStep {
  flowId: string;
  flowName: string;
  nodeId: string;
  question: string;
  options: string[];
}

export type EditorResult<T> = ({ ok: true } & T) | { ok: false; error: string };
