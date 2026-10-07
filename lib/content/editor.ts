/**
 * Que muestra y que ofrece el editor de la pieza (F24).
 *
 * El editor es una sola pagina con secciones, no pestañas: con pestañas, el
 * guion y el caption de una red nunca se ven juntos, que es justo lo que hay
 * que comparar al escribir.
 *
 * Aca vive lo que decide: que botones ofrece segun el permiso y el estado, y
 * como se resume cada red cuando la fila esta cerrada. Puro y testeable.
 */

import type { ContentPostStatus } from "@/lib/types/database";
import { NETWORK_STATE_LABELS, networkState, type ExistingPublication } from "./schedule";
import { hasVariant, type NetworkEntry } from "./redistribution";

export interface EditorPermissions {
  create: boolean;
  approve: boolean;
  publish: boolean;
  /** Generar con IA. */
  ai: boolean;
  isAuthor: boolean;
}

export type EditorAction =
  | "generate_copy"
  | "approve"
  | "return_to_draft"
  | "schedule"
  | "publish_now"
  | "unschedule"
  | "archive";

export interface EditorButton {
  action: EditorAction;
  label: string;
  tone: "primary" | "secondary" | "danger";
  /** Deshabilitado, con el motivo. */
  disabledReason?: string;
}

/**
 * Los botones del editor.
 *
 * Un Member NO ve "Programar", "Publicar ahora" ni "Generar": no es que los
 * vea deshabilitados, no estan. Lo que no se puede hacer nunca no tiene por
 * que ocupar lugar; lo que se puede hacer cuando falta algo, si (y ahi va
 * deshabilitado con el motivo).
 */
export function editorActions(params: {
  status: ContentPostStatus;
  perms: EditorPermissions;
  /** Hay al menos una red con fecha. */
  hasDates: boolean;
  /** Hay un proveedor de IA conectado. */
  aiAvailable: boolean;
  /** Redes que pasaron la validacion. */
  schedulable: number;
}): EditorButton[] {
  const buttons: EditorButton[] = [];
  const editable = ["draft", "in_production", "in_review"].includes(params.status);

  // "Guardar version" y "Enviar a revision" ya no existen (Contenido v4,
  // C6): todo se guarda solo, y el cambio de estado se hace con el dropdown
  // de la cabecera (incluido pasar a En revision), no con un boton aparte.

  if (params.perms.ai && editable) {
    buttons.push({
      action: "generate_copy",
      label: "✦ Generar guion y caption",
      tone: "secondary",
      disabledReason: params.aiAvailable
        ? undefined
        : "Conecta un proveedor de IA en Integraciones.",
    });
  }

  if (params.perms.approve && params.status === "in_review") {
    buttons.push({ action: "approve", label: "Aprobar", tone: "primary" });
    buttons.push({ action: "return_to_draft", label: "Devolver", tone: "secondary" });
  }

  if (params.perms.publish) {
    const programables = ["approved", "scheduled", "published", "partially_published", "failed"];
    if (programables.includes(params.status)) {
      buttons.push({
        action: "schedule",
        label:
          params.schedulable > 1
            ? `Programar ${params.schedulable} redes con fecha`
            : "Programar con fecha",
        tone: "primary",
        disabledReason:
          !params.hasDates
            ? "Elegi una fecha para al menos una red."
            : params.schedulable === 0
              ? "Ninguna red esta lista: revisa los avisos de cada una."
              : undefined,
      });
      buttons.push({ action: "publish_now", label: "Publicar ahora", tone: "secondary" });
    }
  }

  if (params.perms.publish && params.status !== "published") {
    buttons.push({ action: "archive", label: "Archivar", tone: "danger" });
  }

  return buttons;
}

export interface NetworkSummary {
  platform: string;
  /** "Programado · 1 oct 15:00" */
  state: string;
  stateKind: ReturnType<typeof networkState>;
  /** Que usa esa red, en una linea. */
  uses: string;
  cta: string | null;
  hasIssues: boolean;
}

/**
 * El resumen de una red con la fila cerrada.
 *
 * Tiene que alcanzar para saber si falta algo sin abrirla: la fecha, si usa
 * contenido propio y si hay avisos. Si hay que abrir las cinco filas para
 * saber que falta, el resumen no sirve.
 */
export function summarizeNetwork(params: {
  network: NetworkEntry;
  publication: ExistingPublication | undefined;
  timeZone: string;
  errors: number;
  warnings: number;
}): NetworkSummary {
  const kind = networkState(params.network.planned_at ?? null, params.publication);
  const at = params.publication?.scheduledAt ?? params.network.planned_at ?? null;

  const when = at
    ? new Intl.DateTimeFormat("es-AR", {
        timeZone: params.timeZone,
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        // 24 horas: "15:00" no se puede confundir; "03:00 p. m." si, y
        // programar una publicacion doce horas antes es un error caro.
        hour12: false,
      }).format(new Date(at))
    : null;

  const propios: string[] = [];
  if (params.network.caption !== null && params.network.caption !== undefined) propios.push("caption propio");
  if (Array.isArray(params.network.files)) {
    const n = params.network.files.length;
    propios.push(`${n} archivo${n === 1 ? "" : "s"}`);
  } else if (params.network.media !== null && params.network.media !== undefined) {
    propios.push("media propia");
  }

  const cta = params.network.cta;
  return {
    platform: params.network.platform,
    state: when ? `${NETWORK_STATE_LABELS[kind]} · ${when}` : NETWORK_STATE_LABELS[kind],
    stateKind: kind,
    uses: hasVariant(params.network) ? propios.join(" y ") : "usa el caption y la media de la pieza",
    cta: cta && cta.type !== "none" ? `${cta.type}: ${cta.keyword ?? "sin palabra"}` : null,
    hasIssues: params.errors > 0 || params.warnings > 0,
  };
}

/** El estado vacio: no hay ninguna red conectada. */
export function emptyNetworksHint(connected: string[]): string | null {
  if (connected.length > 0) return null;
  return "Todavia no hay ninguna red conectada. Conecta una en Integraciones para poder programar.";
}
