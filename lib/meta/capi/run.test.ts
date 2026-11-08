import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { enqueueCapiEvent, rememberCapiRequestContext, runCapiSend, META_CAPI_JOB } from "./run";
import { sha256 } from "./normalize";

const WS = "ws-1";
const NOW = new Date("2026-11-08T12:00:00Z");

const capiRow = (config: Record<string, unknown> = {}, active = true) => ({
  workspace_id: WS,
  type: "meta",
  provider: "meta_capi",
  is_active: active,
  config: { pixel_id: "1234567890", ...config },
});

const uniqueEvent = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  a.workspace_id === b.workspace_id && a.event_name === b.event_name && a.event_id === b.event_id;

function world(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  return memoryDb(
    {
      integration_configs: [capiRow()],
      contacts: [{ id: "c1", workspace_id: WS, display_name: "Ana Pérez", email: "Ana@mail.com", secondary_email: null, phone: "+5491122334455", whatsapp_phone: null, country: "AR", deleted_at: null }],
      form_submissions: [
        {
          id: "s1",
          workspace_id: WS,
          status: "received",
          contact_id: "c1",
          attribution: { entry_url: "https://negocio.com/clase", fbp: "fb.1.1596403881668.1116446470" },
          meta: { user_agent: "Mozilla/5.0 (viejo)" },
        },
      ],
      bookings: [{ id: "b1", workspace_id: WS, contact_id: "c1", origin: "public_page", utm: { landing_page: "https://negocio.com/agenda", fbc: "fb.1.1554763741205.AbCdEf123" } }],
      meta_capi_request_context: [
        { id: "ctx1", workspace_id: WS, source_type: "form", source_id: "s1", client_ip: "190.12.34.56", user_agent: "Mozilla/5.0", created_at: NOW.toISOString() },
        { id: "ctx2", workspace_id: WS, source_type: "booking", source_id: "b1", client_ip: "190.12.34.57", user_agent: "Mozilla/5.0 (agenda)", created_at: NOW.toISOString() },
      ],
      meta_capi_events: [],
      scheduled_jobs: [],
      contact_touches: [],
      ...seed,
    },
    { unique: { meta_capi_events: uniqueEvent } },
  );
}

const ok = (body: unknown = { events_received: 1, fbtrace_id: "trace" }) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

async function queueBooking(db: ReturnType<typeof world>) {
  const schedule = vi.fn(async () => ({ id: "job" }));
  const queued = await enqueueCapiEvent(
    db.client,
    { workspaceId: WS, eventName: "Schedule", eventId: "booking.b1", sourceType: "booking", sourceId: "b1", eventTime: "2026-11-08T11:58:00Z" },
    { schedule: schedule as never, now: () => NOW },
  );
  return { queued, schedule };
}

// @plantilla-desde(formularios)
async function queueForm(db: ReturnType<typeof world>) {
  const schedule = vi.fn(async () => ({ id: "job" }));
  const queued = await enqueueCapiEvent(
    db.client,
    { workspaceId: WS, eventName: "Lead", eventId: "form.s1", sourceType: "form", sourceId: "s1", eventTime: "2026-11-08T11:58:00Z", params: { content_name: "Clase" } },
    { schedule: schedule as never, now: () => NOW },
  );
  return { queued, schedule };
}
// @plantilla-hasta(formularios)

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("encolar", () => {
  it("anota el evento y encola su envío", async () => {
    const db = world();
    const { queued, schedule } = await queueBooking(db);
    expect(queued.ok).toBe(true);
    expect(db.rows("meta_capi_events")).toHaveLength(1);
    expect(db.rows("meta_capi_events")[0]).toMatchObject({ status: "pending", event_name: "Schedule", event_id: "booking.b1", source_type: "booking" });
    expect(schedule).toHaveBeenCalledWith(db.client, META_CAPI_JOB, { eventLogId: queued.ok ? queued.eventLogId : "", attempt: 1 }, NOW, expect.stringMatching(/^meta_capi:/));
  });

  it("el mismo evento dos veces se anota una sola vez (el índice único)", async () => {
    const db = world();
    await queueBooking(db);
    const { queued, schedule } = await queueBooking(db);
    expect(queued).toMatchObject({ ok: false, reason: "duplicate" });
    expect(schedule).not.toHaveBeenCalled();
    expect(db.rows("meta_capi_events")).toHaveLength(1);
  });
});

describe("mandar", () => {
  // @plantilla-desde(formularios)
  it("manda el evento con los datos frescos de la persona, la IP y el navegador, y lo deja enviado", async () => {
    const db = world();
    const { queued } = await queueForm(db);
    const fetchImpl = ok();
    const outcome = await runCapiSend(db.client, { eventLogId: queued.ok ? queued.eventLogId : "" }, { readToken: async () => "TOKEN", fetchImpl, now: () => NOW });
    expect(outcome).toBe("sent");

    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const event = body.data[0];
    expect(event).toMatchObject({ event_name: "Lead", event_id: "form.s1", action_source: "website", event_source_url: "https://negocio.com/clase" });
    expect(event.custom_data).toEqual({ content_name: "Clase" });
    expect(event.user_data).toMatchObject({
      em: [sha256("ana@mail.com")],
      ph: [sha256("5491122334455")],
      client_ip_address: "190.12.34.56",
      client_user_agent: "Mozilla/5.0",
      fbp: "fb.1.1596403881668.1116446470",
      external_id: [sha256("c1")],
    });
    expect(body.test_event_code).toBeUndefined();
    expect(db.rows("meta_capi_events")[0]).toMatchObject({ status: "sent", fbtrace_id: "trace", action_source: "website", test: false });
  });
  // @plantilla-hasta(formularios)

  it("una reunión pública: de web, con la página, la IP y el navegador de quien agendó", async () => {
    const db = world();
    const { queued } = await queueBooking(db);
    const fetchImpl = ok();
    expect(await runCapiSend(db.client, { eventLogId: queued.ok ? queued.eventLogId : "" }, { readToken: async () => "TOKEN", fetchImpl, now: () => NOW })).toBe("sent");
    const event = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).data[0];
    expect(event).toMatchObject({ event_name: "Schedule", event_id: "booking.b1", action_source: "website", event_source_url: "https://negocio.com/agenda" });
    expect(event.user_data).toMatchObject({ client_ip_address: "190.12.34.57", client_user_agent: "Mozilla/5.0 (agenda)", fbc: "fb.1.1554763741205.AbCdEf123", em: [sha256("ana@mail.com")] });
  });

  it("una reunión que armó el equipo va sin IP y como generada por el sistema", async () => {
    const db = world();
    db.rows("bookings")[0].origin = "manual";
    const { queued } = await queueBooking(db);
    const fetchImpl = ok();
    await runCapiSend(db.client, { eventLogId: queued.ok ? queued.eventLogId : "" }, { readToken: async () => "TOKEN", fetchImpl, now: () => NOW });
    const event = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).data[0];
    expect(event.action_source).toBe("system_generated");
    expect(event.user_data.client_ip_address).toBeUndefined();
  });

  it("con el código de prueba, lo manda a «Probar eventos» y lo anota", async () => {
    const db = world({ integration_configs: [capiRow({ test_event_code: "TEST1" })] });
    const { queued } = await queueBooking(db);
    const fetchImpl = ok();
    await runCapiSend(db.client, { eventLogId: queued.ok ? queued.eventLogId : "" }, { readToken: async () => "TOKEN", fetchImpl, now: () => NOW });
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).test_event_code).toBe("TEST1");
    expect(db.rows("meta_capi_events")[0].test).toBe(true);
  });

  // @plantilla-desde(formularios)
  it("una respuesta marcada como spam no se manda", async () => {
    const db = world();
    db.rows("form_submissions")[0].status = "spam";
    const { queued } = await queueForm(db);
    const fetchImpl = ok();
    expect(await runCapiSend(db.client, { eventLogId: queued.ok ? queued.eventLogId : "" }, { readToken: async () => "TOKEN", fetchImpl, now: () => NOW })).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.rows("meta_capi_events")[0]).toMatchObject({ status: "skipped", skip_reason: "spam" });
  });
  // @plantilla-hasta(formularios)

  it("sin la integración o sin token, se saltea como no configurada", async () => {
    const db = world({ integration_configs: [capiRow({}, false)] });
    const { queued } = await queueBooking(db);
    expect(await runCapiSend(db.client, { eventLogId: queued.ok ? queued.eventLogId : "" }, { readToken: async () => "TOKEN", fetchImpl: ok(), now: () => NOW })).toBe("skipped");
    expect(db.rows("meta_capi_events")[0].skip_reason).toBe("not_configured");

    const db2 = world();
    const second = await queueBooking(db2);
    expect(await runCapiSend(db2.client, { eventLogId: second.queued.ok ? second.queued.eventLogId : "" }, { readToken: async () => null, fetchImpl: ok(), now: () => NOW })).toBe("skipped");
  });

  it("un fallo pasajero de Meta reagenda a 1, 5 y 15 minutos y después queda fallido, sin lanzar", async () => {
    const db = world();
    const { queued } = await queueBooking(db);
    const id = queued.ok ? queued.eventLogId : "";
    const limited = vi.fn(async () => new Response(JSON.stringify({ error: { code: 17, message: "limit" } }), { status: 400 }));
    const schedule = vi.fn(async () => ({ id: "job" }));
    for (const [attempt, minutes] of [[1, 1], [2, 5], [3, 15]] as const) {
      expect(await runCapiSend(db.client, { eventLogId: id, attempt }, { readToken: async () => "TOKEN", fetchImpl: limited, schedule: schedule as never, now: () => NOW })).toBe("retry");
      expect(schedule).toHaveBeenLastCalledWith(db.client, META_CAPI_JOB, { eventLogId: id, attempt: attempt + 1 }, new Date(NOW.getTime() + minutes * 60_000), `meta_capi:${id}:${attempt + 1}`);
    }
    expect(await runCapiSend(db.client, { eventLogId: id, attempt: 4 }, { readToken: async () => "TOKEN", fetchImpl: limited, schedule: schedule as never, now: () => NOW })).toBe("failed");
    expect(db.rows("meta_capi_events")[0]).toMatchObject({ status: "failed" });
  });

  it("un error que no se arregla esperando (un dato inválido) falla de una", async () => {
    const db = world();
    const { queued } = await queueBooking(db);
    const invalid = vi.fn(async () => new Response(JSON.stringify({ error: { code: 100, message: "Invalid parameter" } }), { status: 400 }));
    expect(await runCapiSend(db.client, { eventLogId: queued.ok ? queued.eventLogId : "" }, { readToken: async () => "TOKEN", fetchImpl: invalid, now: () => NOW })).toBe("failed");
  });

  it("un evento ya enviado no se vuelve a mandar", async () => {
    const db = world();
    const { queued } = await queueBooking(db);
    const id = queued.ok ? queued.eventLogId : "";
    await runCapiSend(db.client, { eventLogId: id }, { readToken: async () => "TOKEN", fetchImpl: ok(), now: () => NOW });
    const again = ok();
    expect(await runCapiSend(db.client, { eventLogId: id }, { readToken: async () => "TOKEN", fetchImpl: again, now: () => NOW })).toBe("already");
    expect(again).not.toHaveBeenCalled();
  });

  // @plantilla-desde(ventas)
  it("un pago: Purchase con el monto, sin IP, con las cookies de la venta", async () => {
    const db = world({
      payments: [{ id: "p1", workspace_id: WS, sale_id: "v1", status: "paid", type: "installment" }],
      sales: [{ id: "v1", workspace_id: WS, contact_id: "c1", attribution: { raw: { fbc: "fb.1.1554763741205.AbCdEf123" } } }],
    });
    const schedule = vi.fn(async () => ({ id: "job" }));
    const queued = await enqueueCapiEvent(
      db.client,
      { workspaceId: WS, eventName: "Purchase", eventId: "payment.p1", sourceType: "payment", sourceId: "p1", eventTime: "2026-11-08T10:00:00Z", params: { value: 250, currency: "USD" } },
      { schedule: schedule as never, now: () => NOW },
    );
    const fetchImpl = ok();
    expect(await runCapiSend(db.client, { eventLogId: queued.ok ? queued.eventLogId : "" }, { readToken: async () => "TOKEN", fetchImpl, now: () => NOW })).toBe("sent");
    const event = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).data[0];
    expect(event).toMatchObject({ event_name: "Purchase", action_source: "system_generated", custom_data: { value: 250, currency: "USD", order_id: "p1" } });
    expect(event.user_data.fbc).toBe("fb.1.1554763741205.AbCdEf123");
    expect(event.user_data.client_ip_address).toBeUndefined();
  });
  // @plantilla-hasta(ventas)
});

describe("la IP y el navegador", () => {
  it("se guardan solo si el negocio configuró la API de Conversiones", async () => {
    const db = world({ meta_capi_request_context: [] });
    await rememberCapiRequestContext(db.client, { workspaceId: WS, sourceType: "booking", sourceId: "b1", ip: "190.12.34.56", userAgent: "Mozilla/5.0" });
    expect(db.rows("meta_capi_request_context")).toHaveLength(1);

    const off = world({ meta_capi_request_context: [], integration_configs: [] });
    await rememberCapiRequestContext(off.client, { workspaceId: WS, sourceType: "booking", sourceId: "b1", ip: "190.12.34.56", userAgent: "Mozilla/5.0" });
    expect(off.rows("meta_capi_request_context")).toHaveLength(0);
  });

  it("la IP de relleno de los topes no se guarda", async () => {
    const db = world({ meta_capi_request_context: [] });
    await rememberCapiRequestContext(db.client, { workspaceId: WS, sourceType: "form", sourceId: "s9", ip: "0.0.0.0", userAgent: null });
    expect(db.rows("meta_capi_request_context")).toHaveLength(0);
  });
});
