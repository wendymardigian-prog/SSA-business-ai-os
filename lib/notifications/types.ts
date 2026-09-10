/**
 * Catalogo de tipos de notificacion (F18).
 *
 * Vive en TypeScript y no en un CHECK de la base, igual que el catalogo de
 * proveedores: sumar un tipo nuevo es agregar una entrada aca, no una
 * migracion. Es el mismo criterio que integration_configs.provider.
 *
 * Sin dependencias de servidor: lo importa el Client Component de la campana
 * para saber que icono y que link mostrar.
 */

export const NOTIFICATION_TYPES = [
  "human_takeover",
  "channel_disconnected",
  "channel_reconnected",
  "channel_error",
  "sequence_collision",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** A que apunta la notificacion. Define el deep-link y el scope en la RLS. */
export type NotificationEntity = "conversation" | "channel" | "sequence_enrollment" | "contact";

export interface NotificationDefinition {
  type: NotificationType;
  /** Nombre corto del tipo, para agrupar o filtrar. */
  label: string;
  /**
   * Que tan urgente es. Solo cambia el color del punto en la campana: no hay
   * escalamiento ni silenciado en esta fase.
   */
  tone: "info" | "warning" | "success";
  /** Entidad a la que apunta, cuando siempre es la misma. */
  entity?: NotificationEntity;
}

export const NOTIFICATION_DEFINITIONS: Record<NotificationType, NotificationDefinition> = {
  human_takeover: {
    type: "human_takeover",
    label: "Derivada a una persona",
    tone: "warning",
    entity: "conversation",
  },
  channel_disconnected: {
    type: "channel_disconnected",
    label: "Canal desconectado",
    tone: "warning",
    entity: "channel",
  },
  channel_reconnected: {
    type: "channel_reconnected",
    label: "Canal reconectado",
    tone: "success",
    entity: "channel",
  },
  channel_error: {
    type: "channel_error",
    label: "Problema en un canal",
    tone: "warning",
    entity: "channel",
  },
  sequence_collision: {
    type: "sequence_collision",
    label: "Secuencias en colision",
    tone: "warning",
    entity: "sequence_enrollment",
  },
};

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/** El tono de un tipo, con un default para tipos que no conozca esta version. */
export function toneFor(type: string): NotificationDefinition["tone"] {
  return isNotificationType(type) ? NOTIFICATION_DEFINITIONS[type].tone : "info";
}

/**
 * A donde lleva hacer clic en la notificacion.
 *
 * Devuelve null cuando no hay a donde ir: la campana la muestra igual, sin
 * link, en vez de llevar a una pantalla vacia o a un 404.
 */
export function linkFor(
  entityType: string | null,
  entityId: string | null,
  metadata?: Record<string, unknown> | null,
): string | null {
  if (!entityType) return null;

  switch (entityType) {
    case "conversation":
      return entityId ? `/dashboard/inbox?conversation=${entityId}` : "/dashboard/inbox";

    case "channel":
      return "/dashboard/channels";

    case "sequence_enrollment": {
      // La inscripcion no tiene pantalla propia: se va a la secuencia, que es
      // donde esta el aviso de colision y los botones para resolverla.
      const sequenceId = metadata?.sequence_id;
      return typeof sequenceId === "string"
        ? `/dashboard/sequences/${sequenceId}`
        : "/dashboard/sequences";
    }

    case "contact":
      return entityId ? `/dashboard/contacts/${entityId}` : "/dashboard/contacts";

    default:
      return null;
  }
}

/** "hace 5 minutos", "ayer". Para la lista de la campana. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.floor((now.getTime() - then) / 1000);

  if (seconds < 60) return "recien";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} dias`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
  return `hace mas de un ano`;
}
