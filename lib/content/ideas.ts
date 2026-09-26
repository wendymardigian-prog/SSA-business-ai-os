/**
 * Ideas: que pasa al aprobarlas (F19).
 *
 * Aprobar una idea no la convierte en post: CREA un post y deja la idea
 * aprobada. Son dos cosas distintas a proposito, porque una idea puede
 * originar varias piezas (el mismo angulo para Instagram y para YouTube, o la
 * misma idea retomada meses despues).
 *
 * Lo que hay aca es la decision pura: que campos pasan de la idea al post y
 * que queda pendiente. Escribir las dos filas en una sola transaccion es de la
 * Server Action.
 */

import type { ContentIdeaStatus } from "@/lib/types/database";

export interface IdeaInput {
  title: string;
  hook?: string | null;
  angle?: string | null;
  format?: string | null;
  pillar?: string | null;
  reference?: string | null;
  notes?: string | null;
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
      hook: clean(input.hook),
      angle: clean(input.angle),
      format: clean(input.format),
      pillar: clean(input.pillar),
      reference: clean(input.reference),
      notes: clean(input.notes),
    },
  };
}

export interface ApprovedIdea {
  id: string;
  title: string;
  hook: string | null;
  angle: string | null;
  format: string | null;
  notes: string | null;
  status: ContentIdeaStatus;
}

export interface DraftFromIdea {
  idea_id: string;
  title: string;
  format: string | null;
  /** El copy arranca VACIO: el hook de la idea es una nota, no el guion. */
  copy: { hook: string; body: string; cta: string; recording_notes: string };
  caption: null;
}

/**
 * El post que sale de aprobar una idea.
 *
 * El hook de la idea se copia al hook del copy porque es lo mismo: la frase
 * con la que arranca. El resto del guion queda vacio, y lo escribe una persona
 * o la IA (F29). El caption no se adivina.
 */
export function draftFromIdea(idea: ApprovedIdea): DraftFromIdea {
  return {
    idea_id: idea.id,
    title: idea.title,
    format: idea.format,
    copy: {
      hook: idea.hook ?? "",
      body: "",
      cta: "",
      // El angulo y las notas de la idea son contexto para grabar: se dejan a
      // mano en vez de perderse al aprobar.
      recording_notes: [idea.angle, idea.notes].filter(Boolean).join("\n\n"),
    },
    caption: null,
  };
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
export function ideaActions(
  status: ContentIdeaStatus,
  perms: IdeaActionPermissions,
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

  actions.push({ action: "discard", label: "Descartar" });
  return actions;
}

/** Como se ve una idea propia esperando decision. */
export function ideaWaitingLabel(status: ContentIdeaStatus, canApprove: boolean): string | null {
  if (status !== "nueva") return null;
  return canApprove ? null : "Esperando aprobacion";
}
