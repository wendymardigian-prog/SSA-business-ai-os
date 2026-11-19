/**
 * La pantalla completa de notificaciones (`/dashboard/notificaciones`): reglas puras.
 *
 * Traída de RER-BAIOS (su bloque 33, U1) con el estilo de SSA. Tres vistas («No leídas», «Todas», «Leídas»),
 * siempre arrancando por las no leídas; el dibujo de cada aviso (ícono y color) según a qué apunta; y el negocio
 * del cliente cuando el aviso lo trae en su metadata. Sin ese dato no se inventa: queda vacío.
 */
import { NOTIFICATION_DEFINITIONS, isNotificationType, toneFor } from "@/lib/notifications/types";

export const NOTIFICATION_VIEWS = ["no-leidas", "todas", "leidas"] as const;
export type NotificationView = (typeof NOTIFICATION_VIEWS)[number];

export const NOTIFICATION_VIEW_LABELS: Record<NotificationView, string> = {
  "no-leidas": "No leídas",
  todas: "Todas",
  leidas: "Leídas",
};

/** Avisos por página: la lista se pagina como cualquier otra del sistema. */
export const NOTIFICATIONS_PAGE_SIZE = 50;

export function parseNotificationView(raw: string | string[] | undefined): NotificationView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (NOTIFICATION_VIEWS as readonly string[]).includes(v ?? "") ? (v as NotificationView) : "no-leidas";
}

export function parseNotificationPage(raw: string | string[] | undefined): number {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(v) && v > 1 ? v : 1;
}

/** El link de una vista y una página (la primera página y «No leídas» no van en la URL). */
export function notificationsHref(view: NotificationView, page = 1): string {
  const params = new URLSearchParams();
  if (view !== "no-leidas") params.set("vista", view);
  if (page > 1) params.set("pagina", String(page));
  const qs = params.toString();
  return `/dashboard/notificaciones${qs ? `?${qs}` : ""}`;
}

export type NotificationIcon = "meeting" | "message" | "task" | "alert" | "done" | "bell";
/** Colores del cuadro del ícono: azul, amarillo, verde o neutro (los mismos tonos que el punto de la campana). */
export type NotificationHue = "blue" | "yellow" | "green" | "neutral";

/** El ícono y el color de un aviso, por la entidad a la que apunta y, si no, por su tono. */
export function notificationVisual(entityType: string | null, type: string): { icon: NotificationIcon; hue: NotificationHue } {
  // Sin entidad en la fila, la del catálogo del tipo; si tampoco, el prefijo del tipo (task_…, conversation_…).
  const entity =
    entityType ??
    (isNotificationType(type) ? NOTIFICATION_DEFINITIONS[type].entity : undefined) ??
    (/^(task|conversation|booking|call)_/.exec(type)?.[1] ?? null);
  switch (entity) {
    case "booking":
    case "call":
    case "fathom":
      return { icon: "meeting", hue: "blue" };
    case "conversation":
    case "sequence_enrollment":
    case "draft_queue":
      return { icon: "message", hue: "green" };
    case "task":
      return { icon: "task", hue: "blue" };
  }
  const tone = toneFor(type);
  if (tone === "warning") return { icon: "alert", hue: "yellow" };
  if (tone === "success") return { icon: "done", hue: "green" };
  return { icon: "bell", hue: "neutral" };
}

/** El negocio del cliente al que se refiere el aviso, si viene en la metadata. */
export function notificationBusiness(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  for (const key of ["client_name", "business_name", "company_name"]) {
    const v = metadata[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** La hora corta de la lista: «ahora», «12 min», «2 h», «3 d» y, desde una semana, «28 oct». */
export function shortAgo(iso: string, now: Date, timeZone: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((now.getTime() - then) / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  try {
    return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone }).format(new Date(iso)).replace(".", "");
  } catch {
    return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso)).replace(".", "");
  }
}

/** «4 sin leer»; con 0, nada (la pastilla no se dibuja). */
export function unreadPillText(unread: number): string | null {
  return unread > 0 ? `${unread} sin leer` : null;
}

/** Lo que dice la lista vacía de cada vista. */
export function emptyViewText(view: NotificationView): { title: string; body: string } {
  if (view === "no-leidas") return { title: "Todo leído", body: "No tenés avisos sin leer. Los anteriores están en «Todas»." };
  if (view === "leidas") return { title: "Ningún aviso leído", body: "Acá aparecen los avisos que ya abriste o marcaste como leídos." };
  return { title: "Todo tranquilo", body: "Te avisamos acá cuando algo necesite tu atención." };
}
