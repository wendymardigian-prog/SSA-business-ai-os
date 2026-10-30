import { describe, expect, it, vi } from "vitest";
import { deliverNotification, deliveryRecipients, type DeliverDeps, type DeliveryNotification, type Recipient } from "./deliver";
import { whatsappText } from "@/lib/jobs/handlers/notification-deliver";

const NOW = new Date("2026-10-30T15:00:00Z");
const WS = "11111111-1111-4111-8111-111111111111";
const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRUNO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function notification(over: Partial<DeliveryNotification> = {}): DeliveryNotification {
  return {
    id: "n1",
    workspace_id: WS,
    type: "booking_created",
    title: "Agenda nueva",
    body: "Juan agendó para mañana",
    entity_type: "booking",
    entity_id: "b1",
    metadata: {},
    recipient_id: ANA,
    created_at: "2026-10-30T14:59:00Z",
    ...over,
  };
}

function deps(over: Partial<DeliverDeps> & { recipients?: Recipient[]; n?: DeliveryNotification | null } = {}) {
  const recipients = over.recipients ?? [{ userId: ANA, email: "ana@x.com", whatsapp: "+5491100000000", prefs: { bookings: { email: true, whatsapp: true } } }];
  const d: DeliverDeps = {
    loadNotification: vi.fn(async () => (over.n === undefined ? notification() : over.n)),
    loadAdminIds: vi.fn(async () => [ANA, BRUNO]),
    isMember: vi.fn(async () => true),
    loadRecipients: vi.fn(async (_ws: string, ids: string[]) => recipients.filter((r) => ids.includes(r.userId))),
    recentDeliveries: vi.fn(async () => []),
    channelsAvailable: vi.fn(async () => ({ email: true, whatsapp: true })),
    sendEmail: vi.fn(async () => ({ ok: true })),
    sendWhatsApp: vi.fn(async () => ({ ok: true })),
    markDelivered: vi.fn(async () => undefined),
    scheduleRetry: vi.fn(async () => undefined),
    now: () => NOW,
    ...over,
  };
  return d;
}

describe("deliverNotification", () => {
  it("manda por los canales que la persona eligio y anota cada envio", async () => {
    const d = deps();
    const out = await deliverNotification(d, "n1");
    expect(out).toEqual({ status: "done", sent: 2, skipped: 0, retry: false });
    expect(d.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }), "ana@x.com", "/dashboard/agenda?agenda=b1");
    expect(d.sendWhatsApp).toHaveBeenCalledWith(expect.anything(), "+5491100000000", "/dashboard/agenda?agenda=b1");
    expect(d.markDelivered).toHaveBeenCalledWith("n1", `${ANA}:email`, NOW.toISOString());
    expect(d.markDelivered).toHaveBeenCalledWith("n1", `${ANA}:whatsapp`, NOW.toISOString());
  });

  it("con los valores por defecto (solo campana) no manda nada ni consulta los canales", async () => {
    const d = deps({ recipients: [{ userId: ANA, email: "ana@x.com", whatsapp: "+5491100000000", prefs: {} }] });
    const out = await deliverNotification(d, "n1");
    expect(out).toEqual({ status: "done", sent: 0, skipped: 0, retry: false });
    expect(d.channelsAvailable).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
    expect(d.sendWhatsApp).not.toHaveBeenCalled();
  });

  it("lo critico va por email por defecto (un chat que necesita una persona)", async () => {
    const d = deps({ n: notification({ type: "needs_human", entity_type: "conversation", entity_id: "c1" }), recipients: [{ userId: ANA, email: "ana@x.com", whatsapp: null, prefs: {} }] });
    await deliverNotification(d, "n1");
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    expect(d.sendWhatsApp).not.toHaveBeenCalled();
  });

  it("un aviso general va a Owner/Admin, cada uno con lo suyo", async () => {
    const d = deps({
      n: notification({ recipient_id: null, type: "channel_disconnected", entity_type: "channel" }),
      recipients: [
        { userId: ANA, email: "ana@x.com", whatsapp: null, prefs: {} },
        { userId: BRUNO, email: "bruno@x.com", whatsapp: null, prefs: { channel_status: { email: false } } },
      ],
    });
    await deliverNotification(d, "n1");
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    expect(d.sendEmail).toHaveBeenCalledWith(expect.anything(), "ana@x.com", "/dashboard/channels");
  });

  it("no repite lo que ya salio en un intento anterior", async () => {
    const d = deps({ n: notification({ metadata: { delivered: { [`${ANA}:email`]: "2026-10-30T14:59:30Z" } } }) });
    await deliverNotification(d, "n1");
    expect(d.sendEmail).not.toHaveBeenCalled();
    expect(d.sendWhatsApp).toHaveBeenCalledTimes(1);
  });

  it("tope: si a la misma persona ya le llego uno igual hace menos de 10 minutos, no manda", async () => {
    const d = deps({ recentDeliveries: vi.fn(async () => [{ [`${ANA}:whatsapp`]: "2026-10-30T14:55:00Z" }]) });
    const out = await deliverNotification(d, "n1");
    expect(d.sendWhatsApp).not.toHaveBeenCalled();
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ sent: 1, skipped: 1 });
    expect(d.recentDeliveries).toHaveBeenCalledWith(expect.anything(), ["booking_created", "booking_rescheduled", "booking_cancelled"], new Date(NOW.getTime() - 10 * 60_000));
  });

  it("sin email conectado o sin WhatsApp cargado, saltea ese canal sin fallar", async () => {
    const d = deps({
      channelsAvailable: vi.fn(async () => ({ email: false, whatsapp: true })),
      recipients: [{ userId: ANA, email: "ana@x.com", whatsapp: null, prefs: { bookings: { email: true, whatsapp: true } } }],
    });
    const out = await deliverNotification(d, "n1");
    expect(d.sendEmail).not.toHaveBeenCalled();
    expect(d.sendWhatsApp).not.toHaveBeenCalled();
    expect(out).toMatchObject({ sent: 0, skipped: 2, retry: false });
  });

  it("un fallo del proveedor que se puede reintentar reagenda a 1, 5 y 15 minutos, y despues se rinde", async () => {
    const failing = { sendEmail: vi.fn(async () => ({ ok: false, retryable: true })), sendWhatsApp: vi.fn(async () => ({ ok: true })) };
    const minutes: number[] = [];
    for (const attempt of [0, 1, 2, 3]) {
      const d = deps({ ...failing, scheduleRetry: vi.fn(async (_id: string, _a: number, at: Date) => void minutes.push((at.getTime() - NOW.getTime()) / 60_000)) });
      const out = await deliverNotification(d, "n1", attempt);
      expect(out).toMatchObject({ retry: attempt < 3 });
    }
    expect(minutes).toEqual([1, 5, 15]);
  });

  it("un fallo que no se puede reintentar (numero invalido) no reagenda", async () => {
    const d = deps({ sendWhatsApp: vi.fn(async () => ({ ok: false, retryable: false })) });
    const out = await deliverNotification(d, "n1");
    expect(d.scheduleRetry).not.toHaveBeenCalled();
    expect(out).toMatchObject({ sent: 1, skipped: 1, retry: false });
  });

  it("un aviso viejo, borrado o de un tipo desconocido no manda nada", async () => {
    expect(await deliverNotification(deps({ n: null }), "n1")).toEqual({ status: "missing" });
    expect(await deliverNotification(deps({ n: notification({ created_at: "2026-10-29T10:00:00Z" }) }), "n1")).toEqual({ status: "too_old" });
    expect(await deliverNotification(deps({ n: notification({ type: "tipo_del_futuro" }) }), "n1")).toEqual({ status: "unknown_type" });
  });

  it("a alguien que ya no es del negocio no le llega", async () => {
    const d = deps({ isMember: vi.fn(async () => false) });
    expect(await deliverNotification(d, "n1")).toEqual({ status: "no_recipients" });
    expect(d.sendEmail).not.toHaveBeenCalled();
  });
});

describe("deliveryRecipients", () => {
  it("la persona concreta, o los admins sin repetir", async () => {
    const d = deps({ loadAdminIds: vi.fn(async () => [ANA, ANA, BRUNO]) });
    expect(await deliveryRecipients(d, notification())).toEqual([ANA]);
    expect(await deliveryRecipients(d, notification({ recipient_id: null }))).toEqual([ANA, BRUNO]);
  });
});

describe("whatsappText", () => {
  it("negocio, titulo, cuerpo y link", () => {
    expect(whatsappText("Mi Negocio", { title: "Agenda nueva", body: "Juan" }, "https://app/x")).toBe("*Mi Negocio* · Agenda nueva\nJuan\nhttps://app/x");
    expect(whatsappText("N", { title: "T", body: null }, null)).toBe("*N* · T");
  });
});
