/**
 * Programar una red (F25).
 *
 * La distincion que organiza todo el modulo:
 *
 *   **Fecha tentativa** = `networks[].planned_at` en la pieza. Sirve para
 *   planificar y se ve en el calendario, pero NO hay nada agendado.
 *
 *   **Programado** = existe una fila en `social_posts` con `status =
 *   'scheduled'` y su job en la cola.
 *
 * Confundir las dos es creer que algo va a salir solo cuando no va a salir.
 * Por eso el calendario dibuja lo tentativo con borde punteado y por eso
 * programar es un acto explicito.
 *
 * Todo puro: decide, no escribe.
 */

import type { SocialPostStatus } from "@/lib/types/database";

/** Margen minimo entre ahora y la hora de salida. */
export const MIN_LEAD_MINUTES = 5;

export interface NetworkPlan {
  platform: string;
  /** La fecha tentativa. */
  plannedAt: string | null;
  publisher?: string | null;
}

export interface ExistingPublication {
  platform: string;
  status: SocialPostStatus | null;
  scheduledAt: string | null;
}

export interface SchedulePermissions {
  publish: boolean;
}

export interface ScheduleContext {
  postStatus: string;
  perms: SchedulePermissions;
  /** Las redes que el workspace tiene conectadas, con cuenta activa. */
  connected: string[];
  /**
   * Por donde publica la cuenta activa de cada red
   * (`social_accounts.default_publisher`).
   *
   * Es el respaldo de `networks[].publisher`, que la pantalla casi nunca
   * escribe. Sin ninguno de los dos no se programa: una fila sin publicador
   * llega al despachador, que no sabe con que publicarla y la da por perdida
   * para siempre.
   */
  defaultPublishers?: Record<string, string | null>;
  existing: ExistingPublication[];
  now?: Date;
  /**
   * `now` es "Publicar ahora": sale en este momento, asi que no tiene sentido
   * exigirle anticipacion. Con el modo normal la fecha tiene que estar en el
   * futuro y con margen.
   */
  mode?: "scheduled" | "now";
}

export type ScheduleDecision =
  | { ok: true; at: string; publisher: string | null }
  | { ok: false; error: string };

/**
 * Si se puede programar una red, y con que fecha.
 *
 * El orden de los chequeos no es casual: primero lo que depende de la persona
 * (permiso), despues lo que depende de la configuracion (cuenta conectada), y
 * al final lo que depende del momento (la fecha). Asi el primer mensaje que
 * ve es el mas accionable.
 */
export function canScheduleNetwork(
  network: NetworkPlan,
  context: ScheduleContext,
): ScheduleDecision {
  const now = context.now ?? new Date();

  if (!context.perms.publish) {
    return { ok: false, error: "Programar es de quien puede publicar." };
  }

  // Aprobada, o ya programada (reprogramar una red no exige volver a aprobar).
  const approved = ["approved", "scheduled", "publishing", "published", "partially_published", "failed"];
  if (!approved.includes(context.postStatus)) {
    return { ok: false, error: "La pieza tiene que estar aprobada antes de programarla." };
  }

  if (!context.connected.includes(network.platform)) {
    return {
      ok: false,
      error: `No hay una cuenta de ${network.platform} conectada. Conectala en Integraciones.`,
    };
  }

  const publisher =
    network.publisher ?? context.defaultPublishers?.[network.platform] ?? null;
  if (!publisher) {
    return {
      ok: false,
      error: `Elegi por donde se publica ${network.platform} en Integraciones.`,
    };
  }

  const already = context.existing.find((p) => p.platform === network.platform);
  if (already && (already.status === "publishing" || already.status === "published")) {
    return {
      ok: false,
      error:
        already.status === "published"
          ? `Esa pieza ya se publico en ${network.platform}.`
          : `Esa pieza se esta publicando en ${network.platform} en este momento.`,
    };
  }

  // Publicar ahora sale ya: no hay fecha que elegir ni margen que respetar.
  if (context.mode === "now") {
    return { ok: true, at: now.toISOString(), publisher };
  }

  if (!network.plannedAt) {
    return { ok: false, error: `Elegi una fecha para ${network.platform}.` };
  }

  const at = new Date(network.plannedAt);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, error: "Esa fecha no se entiende." };
  }

  const minutes = (at.getTime() - now.getTime()) / 60000;
  if (minutes < 0) {
    return { ok: false, error: "Esa fecha ya paso." };
  }
  if (minutes < MIN_LEAD_MINUTES) {
    // La cola corre cada minuto y el publicador tarda: con menos margen la
    // publicacion sale tarde o no sale.
    return {
      ok: false,
      error: `Falta muy poco: elegi una hora al menos ${MIN_LEAD_MINUTES} minutos despues de ahora.`,
    };
  }

  return { ok: true, at: at.toISOString(), publisher };
}

export interface SchedulePlan {
  /** Redes que se van a programar, con su fecha. */
  schedule: Array<{ platform: string; at: string; publisher: string | null }>;
  /** Las que no, con el motivo. */
  skipped: Array<{ platform: string; reason: string }>;
}

/**
 * Que hacer con varias redes a la vez ("Programar N redes con fecha").
 *
 * Las que se pueden se programan; las que no, se saltean con su motivo. No se
 * frena todo por una: programar dos de tres es mejor que no programar ninguna,
 * y el motivo de la tercera queda a la vista.
 */
export function planSchedule(
  networks: NetworkPlan[],
  context: ScheduleContext,
): SchedulePlan {
  const plan: SchedulePlan = { schedule: [], skipped: [] };

  for (const network of networks) {
    // Una red sin fecha no es un error que haya que mostrar al programar
    // todas: simplemente todavia no entra. Salvo en "Publicar ahora", donde
    // la fecha es este momento y la red sin fecha tambien sale.
    if (!network.plannedAt && context.mode !== "now") continue;

    const decision = canScheduleNetwork(network, context);
    if (decision.ok) {
      plan.schedule.push({ platform: network.platform, at: decision.at, publisher: decision.publisher });
    } else {
      plan.skipped.push({ platform: network.platform, reason: decision.error });
    }
  }

  return plan;
}

export type UnscheduleDecision =
  | { ok: true; keepsPlannedAt: string | null }
  | { ok: false; error: string };

/**
 * Desprogramar una red.
 *
 * La fila pasa a `cancelled` y la fecha tentativa se CONSERVA: desprogramar es
 * "todavia no", no "nunca". Perder la fecha obligaria a elegirla de nuevo.
 */
export function canUnschedule(
  publication: ExistingPublication,
  perms: SchedulePermissions,
  plannedAt: string | null,
): UnscheduleDecision {
  if (!perms.publish) return { ok: false, error: "Desprogramar es de quien puede publicar." };

  if (publication.status === "published") {
    return { ok: false, error: "Eso ya se publico: no se puede desprogramar." };
  }
  if (publication.status === "publishing") {
    return { ok: false, error: "Se esta publicando en este momento." };
  }
  if (publication.status !== "scheduled" && publication.status !== "failed") {
    return { ok: false, error: "Esa red no esta programada." };
  }

  return { ok: true, keepsPlannedAt: plannedAt ?? publication.scheduledAt };
}

/** Publicar ahora: la misma fila, con la hora de este momento. */
export function publishNowAt(now: Date = new Date()): string {
  return now.toISOString();
}

/** Como se ve el estado de una red en el editor y en la tarjeta. */
export type NetworkDisplayState =
  | "no_date"
  | "tentative"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export function networkState(
  plannedAt: string | null,
  publication: ExistingPublication | undefined,
): NetworkDisplayState {
  if (publication) {
    switch (publication.status) {
      case "published":
        return "published";
      case "publishing":
        return "publishing";
      case "failed":
        return "failed";
      case "scheduled":
        return "scheduled";
      // 'cancelled' vuelve al estado de la fecha: se desprogramo.
      default:
        break;
    }
  }
  if (!plannedAt) return "no_date";
  return "tentative";
}

export const NETWORK_STATE_LABELS: Record<NetworkDisplayState, string> = {
  no_date: "Sin fecha",
  tentative: "Fecha tentativa",
  scheduled: "Programado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Fallo",
};
