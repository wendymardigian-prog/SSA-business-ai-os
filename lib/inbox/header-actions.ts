/**
 * Que va a la vista y que va al menu "⋯" en la cabecera de una conversacion.
 *
 * Antes eran hasta nueve iconos en una fila (estado, flows pausados, agente
 * apagado por etiqueta, modo borrador, necesita humano, interruptor del agente,
 * crear tarea, cerrar, posponer, reabrir): en el telefono se partian en dos
 * renglones y competian con el hilo. Ahora:
 *
 *  - A la vista, siempre: el interruptor del agente y la accion mas frecuente,
 *    que es cerrar (o reabrir, si ya esta cerrada). "Necesita humano" tambien:
 *    es una alerta, no un detalle.
 *  - En el menu: posponer, reabrir una pospuesta, crear tarea.
 *  - Los avisos de estado (flows pausados, agente apagado por etiqueta, modo
 *    borrador) pasan a ser filas de texto del menu, con un punto en el boton si
 *    hay alguno: antes eran iconos que solo se entendian con el mouse encima.
 *
 * Puro: lo prueba un test y el componente solo lo dibuja.
 */

import type { ConversationStatus } from "@/lib/types/database";

export type MenuAction = "snooze" | "reopen" | "createTask" | "markKnown" | "unmarkKnown";
export type NoteKey = "status" | "flowsPaused" | "agentOffByTag" | "draftMode" | "known";

export interface HeaderInput {
  status: ConversationStatus;
  canCreateTask: boolean;
  isAutomationPaused: boolean;
  agentDisabledByTag: boolean;
  /** El agente atiende este canal en modo borrador. */
  draftMode: boolean;
  /**
   * Conocido (00256): si el contacto lo es y que puede hacer quien mira. Marcar
   * pide `contacts.edit`; quitar, haberla puesto o `contacts.delete`.
   */
  known?: { isKnown: boolean; canMark: boolean; canUnmark: boolean };
}

export interface HeaderPlan {
  /** El boton que queda a la vista junto al interruptor del agente. */
  primary: "close" | "reopen";
  /** Lo que va adentro del menu, en orden. */
  menu: MenuAction[];
  /** Filas de texto del menu (sin accion). `status` va siempre primero. */
  notes: NoteKey[];
  /** ¿El boton "⋯" lleva el punto de aviso? Solo cuenta lo que no es el estado. */
  hasAlert: boolean;
}

export function planHeaderActions(input: HeaderInput): HeaderPlan {
  const primary: HeaderPlan["primary"] = input.status === "closed" ? "reopen" : "close";

  const menu: MenuAction[] = [];
  if (input.status !== "snoozed") menu.push("snooze");
  // Una pospuesta se reabre desde el menu; una cerrada, desde el boton a la vista.
  if (input.status === "snoozed") menu.push("reopen");
  if (input.canCreateTask) menu.push("createTask");
  if (input.known && !input.known.isKnown && input.known.canMark) menu.push("markKnown");
  if (input.known?.isKnown && input.known.canUnmark) menu.push("unmarkKnown");

  const notes: NoteKey[] = ["status"];
  if (input.isAutomationPaused) notes.push("flowsPaused");
  if (input.agentDisabledByTag) notes.push("agentOffByTag");
  if (input.draftMode) notes.push("draftMode");
  if (input.known?.isKnown) notes.push("known");

  return { primary, menu, notes, hasAlert: notes.length > 1 };
}

export const NOTE_TEXT: Record<Exclude<NoteKey, "status">, { title: string; detail: string }> = {
  flowsPaused: {
    title: "Flows pausados",
    detail: "Las automatizaciones no corren en esta conversación.",
  },
  agentOffByTag: {
    title: "Agente apagado por etiqueta",
    detail: "El contacto tiene una etiqueta que apaga el agente (por ejemplo es-conocido). Prenderlo a mano gana sobre la etiqueta.",
  },
  known: {
    title: "Conocido",
    detail: "Es un contacto personal: el agente no le responde y no recibe secuencias. Las automatizaciones siguen corriendo.",
  },
  draftMode: {
    title: "Modo borrador",
    detail: "En este canal el agente deja borradores para aprobar. Nada sale sin que alguien lo envíe.",
  },
};
