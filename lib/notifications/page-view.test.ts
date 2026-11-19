import { describe, expect, it } from "vitest";
import {
  emptyViewText,
  notificationBusiness,
  notificationVisual,
  notificationsHref,
  parseNotificationPage,
  parseNotificationView,
  shortAgo,
  unreadPillText,
} from "./page-view";

describe("pantalla de notificaciones", () => {
  it("arranca siempre por las no leídas y acepta solo las tres vistas", () => {
    expect(parseNotificationView(undefined)).toBe("no-leidas");
    expect(parseNotificationView("todas")).toBe("todas");
    expect(parseNotificationView(["leidas"])).toBe("leidas");
    expect(parseNotificationView("otra")).toBe("no-leidas");
  });

  it("la página es un entero mayor que 1 o la primera", () => {
    expect(parseNotificationPage("3")).toBe(3);
    expect(parseNotificationPage("0")).toBe(1);
    expect(parseNotificationPage("x")).toBe(1);
    expect(parseNotificationPage(undefined)).toBe(1);
  });

  it("el link no lleva lo que es por defecto", () => {
    expect(notificationsHref("no-leidas")).toBe("/dashboard/notificaciones");
    expect(notificationsHref("todas")).toBe("/dashboard/notificaciones?vista=todas");
    expect(notificationsHref("leidas", 2)).toBe("/dashboard/notificaciones?vista=leidas&pagina=2");
    expect(notificationsHref("no-leidas", 3)).toBe("/dashboard/notificaciones?pagina=3");
  });

  it("dibuja cada aviso por lo que apunta", () => {
    expect(notificationVisual("booking", "x")).toEqual({ icon: "meeting", hue: "blue" });
    expect(notificationVisual("conversation", "human_takeover")).toEqual({ icon: "message", hue: "green" });
    expect(notificationVisual(null, "channel_disconnected")).toEqual({ icon: "alert", hue: "yellow" });
    expect(notificationVisual(null, "desconocido")).toEqual({ icon: "bell", hue: "neutral" });
  });

  it("sin entidad en la fila, usa la del tipo o su prefijo", () => {
    expect(notificationVisual(null, "task_assigned").icon).toBe("task");
    expect(notificationVisual(null, "conversation_algo_nuevo").icon).toBe("message");
  });

  it("la hora corta: min, h, d y la fecha desde una semana", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(shortAgo("2026-11-16T11:59:40Z", now, "America/Costa_Rica")).toBe("ahora");
    expect(shortAgo("2026-11-16T11:48:00Z", now, "America/Costa_Rica")).toBe("12 min");
    expect(shortAgo("2026-11-16T10:00:00Z", now, "America/Costa_Rica")).toBe("2 h");
    expect(shortAgo("2026-11-13T12:00:00Z", now, "America/Costa_Rica")).toBe("3 d");
    expect(shortAgo("2026-10-28T18:00:00Z", now, "America/Costa_Rica")).toBe("28 oct");
    expect(shortAgo("no-es-fecha", now, "America/Costa_Rica")).toBe("");
    expect(shortAgo("2026-10-28T18:00:00Z", now, "Zona/Inventada")).toBe("28 oct");
  });

  it("el negocio sale de la metadata o queda vacío (no se inventa)", () => {
    expect(notificationBusiness({ client_name: " Negocio de prueba " })).toBe("Negocio de prueba");
    expect(notificationBusiness({ business_name: "Otro" })).toBe("Otro");
    expect(notificationBusiness({ client_name: "" })).toBeNull();
    expect(notificationBusiness({})).toBeNull();
    expect(notificationBusiness(null)).toBeNull();
  });

  it("la pastilla solo con avisos sin leer y cada vista vacía con su texto", () => {
    expect(unreadPillText(4)).toBe("4 sin leer");
    expect(unreadPillText(0)).toBeNull();
    expect(emptyViewText("no-leidas").title).toBe("Todo leído");
    expect(emptyViewText("todas").title).toBe("Todo tranquilo");
    expect(emptyViewText("leidas").body).toContain("abriste");
  });
});
