/**
 * Ideas: que pasa al aprobarlas (F19).
 *
 * Aprobar una idea no la convierte en post: CREA un post y deja la idea
 * aprobada. Son dos cosas distintas a proposito, porque una idea puede
 * originar varias piezas (el mismo angulo para Instagram y para YouTube, o la
 * misma idea retomada meses despues).
 *
 * Lo que hay aca es la validacion de la idea y que botones se ofrecen. Que
 * campos pasan de la idea a la pieza lo decide `approve_content_idea_v2` (la
 * funcion SQL), que escribe las dos filas en una sola transaccion: el guion y
 * las notas de grabacion arrancan VACIOS, porque el texto de la idea es
 * contexto y no el guion.
 */

import type { ContentIdeaStatus } from "@/lib/types/database";

export interface IdeaInput {
  title: string;
  /** El texto unico de la idea: hook, angulo y notas juntos (F90). */
  content?: string | null;
  format?: string | null;
  reference?: string | null;
}

export type IdeaValidation = { ok: true; idea: IdeaInput } | { ok: false; error: string };

/** El titulo es lo unico obligatorio: una idea sin titulo no se puede ni leer. */
export function validateIdea(input: IdeaInput): IdeaValidation {
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, error: "La idea necesita un titulo" };
  if (title.length > 200) {
    return { ok: false, error: "El titulo es muy largo: maximo 200 caracteres" };
  }

  const clean = (value: string | null | undefined) => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
  };

  return {
    ok: true,
    idea: {
      title,
      content: clean(input.content),
      format: clean(input.format),
      reference: clean(input.reference),
    },
  };
}

/**
 * El comienzo del texto de una idea, para la tarjeta del tablero (C13).
 *
 * La primera linea con algo escrito, recortada a `max` caracteres. Antes la
 * tarjeta mostraba el hook entre comillas; con el texto unico (F90) el
 * comienzo del texto cumple ese papel: es de lo que uno se acuerda.
 */
export function contentExcerpt(content: string | null | undefined, max = 110): string | null {
  const first = (content ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  if (!first) return null;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

export type IdeaAction = "approve" | "approve_and_generate" | "discard";

export interface IdeaActionPermissions {
  approve: boolean;
  /** Generar copy con IA. */
  ai: boolean;
  /** Hay un proveedor de IA conectado en el workspace. */
  aiAvailable: boolean;
}

export interface AvailableAction {
  action: IdeaAction;
  label: string;
  /** Cuando esta deshabilitada, por que. */
  disabledReason?: string;
}

/**
 * Los botones de una tarjeta de idea, para quien la esta mirando.
 *
 * "Aprobar y producir copy" aparece deshabilitado con el motivo en vez de
 * desaparecer: que un boton exista y explique por que no se puede usar enseña
 * que la funcion existe; que no aparezca, no.
 */
/**
 * Las acciones de una idea.
 *
 * `withDiscard` es para el detalle, que es el unico lugar donde se puede
 * descartar: ahi hay espacio para el motivo y para pensarlo.
 */
export function ideaActions(
  status: ContentIdeaStatus,
  perms: IdeaActionPermissions,
  options: { withDiscard?: boolean } = {},
): AvailableAction[] {
  if (status !== "nueva" || !perms.approve) return [];

  const actions: AvailableAction[] = [{ action: "approve", label: "Aprobar" }];

  if (perms.ai) {
    actions.push({
      action: "approve_and_generate",
      label: "Aprobar y producir copy",
      disabledReason: perms.aiAvailable
        ? undefined
        : "Conecta un proveedor de IA en Integraciones para generar el guion.",
    });
  }

  if (options.withDiscard) actions.push({ action: "discard", label: "Descartar" });

  // "Descartar" NO va en la tarjeta (C3): es la unica accion destructiva de
  // las tres, y tenerla al lado de "Aprobar" en una tarjeta chica es pedir
  // que alguien la toque sin querer. Vive en el detalle, con su motivo.
  return actions;
}

/** Como se ve una idea propia esperando decision. */
export function ideaWaitingLabel(status: ContentIdeaStatus, canApprove: boolean): string | null {
  if (status !== "nueva") return null;
  return canApprove ? null : "Esperando aprobacion";
}

/**
 * Los formatos que se usan, para ofrecerlos en vez de hacerlos escribir (C2).
 *
 * Es una sugerencia y no una lista cerrada: el campo sigue siendo texto
 * libre, porque manana aparece un formato que hoy no existe y nadie quiere
 * pedir un deploy para poder escribirlo.
 */
export const FORMAT_SUGGESTIONS = [
  "Reel",
  "Carrusel",
  "Video",
  "Imagen",
  "Historia",
  "Short",
  "Texto",
  "Documento",
] as const;
