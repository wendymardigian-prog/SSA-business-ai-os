import { describe, expect, it } from "vitest";
import { applyListClauses, contactListPlan, parseContactListFilters } from "../list-query";
import { bookingCells } from "./bookings";
import { conversationCells } from "./conversations";

const A = "9f0d1b6e-1111-2222-3333-444455556666";
const B = "9f0d1b6e-aaaa-bbbb-cccc-ddddeeeeffff";
const CTX = { now: new Date("2026-11-03T15:00:00Z"), timeZone: "America/Costa_Rica" };
const plan = (params: Record<string, string | string[]>) => {
  const p = contactListPlan(parseContactListFilters(params, []), null, CTX);
  return { embeds: p.embeds, clauses: p.clauses.filter((c) => !("column" in c && c.column === "is_anonymous")) };
};

describe("agenda", () => {
  it("varias condiciones de agenda son UNA agenda que cumple todo", () => {
    expect(plan({ agenda: "si", estado_agenda: ["confirmed", "scheduled"], tipo_evento: A, fecha_agenda: "proximas" })).toEqual({
      embeds: ["con_bookings:bookings!inner(id,status,event_type_id,start_at)"],
      clauses: [
        { op: "in", column: "con_bookings.status", values: ["confirmed", "scheduled"] },
        { op: "in", column: "con_bookings.event_type_id", values: [A] },
        { op: "gte", column: "con_bookings.start_at", value: "2026-11-03T15:00:00.000Z" },
      ],
    });
  });

  it("sin agenda es un anti-join", () => {
    expect(plan({ agenda: "no" })).toEqual({ embeds: ["sin_bookings_1:bookings(id)"], clauses: [{ op: "is_null", column: "sin_bookings_1" }] });
  });

  it("un estado inventado se ignora", () => {
    expect(plan({ estado_agenda: "vendida" })).toEqual({ embeds: [], clauses: [] });
  });

  it("las columnas: la próxima activa, la última pasada y cuántas", () => {
    const rows = [
      { contact_id: A, start_at: "2026-10-01T15:00:00Z", status: "no_show", title: "Llamada 1" },
      { contact_id: A, start_at: "2026-11-10T15:00:00Z", status: "cancelled_other", title: "Cancelada" },
      { contact_id: A, start_at: "2026-11-12T15:00:00Z", status: "confirmed", title: "Llamada 2" },
    ];
    const cells = bookingCells([A, B], ["next_booking", "last_booking", "bookings_count"], rows, CTX.now);
    expect(cells[A].next_booking).toEqual({ t: "date", at: "2026-11-12T15:00:00Z", mode: "datetime", sub: "Llamada 2" });
    expect(cells[A].last_booking).toEqual({ t: "date", at: "2026-10-01T15:00:00Z", mode: "day", sub: "No-show" });
    expect(cells[A].bookings_count).toEqual({ t: "number", n: 3, sub: "1 próxima" });
    expect(cells[B]).toEqual({ next_booking: null, last_booking: null, bookings_count: null });
  });
});

describe("conversaciones", () => {
  it("responsable del chat: personas, «sin responsable» o las dos cosas (un `or` sobre el join)", () => {
    expect(plan({ responsable: A }).clauses).toEqual([
      { op: "is_null", column: "con_conversations.deleted_at" },
      { op: "in", column: "con_conversations.assigned_to", values: [A] },
    ]);
    expect(plan({ responsable: ["ninguno", A] }).clauses).toContainEqual({
      op: "or",
      filter: `assigned_to.is.null,assigned_to.in.(${A})`,
      table: "con_conversations",
    });
  });

  it("el `or` de un join va con su tabla", () => {
    const calls: unknown[][] = [];
    const builder = { or: (...args: unknown[]) => (calls.push(args), builder) };
    applyListClauses(builder, [{ op: "or", filter: "x.is.null", table: "con_conversations" }, { op: "or", filter: "y.eq.1" }]);
    expect(calls).toEqual([["x.is.null", { referencedTable: "con_conversations" }], ["y.eq.1"]]);
  });

  it("esperando respuesta: la marca del trigger, sin las que no necesitan respuesta", () => {
    expect(plan({ esperando: "si" })).toEqual({
      embeds: ["con_conversations:conversations!inner(awaiting_reply_since,no_reply_needed_at,deleted_at)"],
      clauses: [
        { op: "is_null", column: "con_conversations.deleted_at" },
        { op: "not_null", column: "con_conversations.awaiting_reply_since" },
        { op: "is_null", column: "con_conversations.no_reply_needed_at" },
      ],
    });
  });

  it("las columnas: responsable, canales sin repetir, último mensaje y la espera más vieja", () => {
    const rows = [
      { contact_id: A, platform: "instagram", assigned_to: null, last_message_at: "2026-11-02T10:00:00Z", last_message_preview: "Hola", awaiting_reply_since: "2026-11-02T10:00:00Z", no_reply_needed_at: null },
      { contact_id: A, platform: "whatsapp", assigned_to: B, last_message_at: "2026-11-01T10:00:00Z", last_message_preview: null, awaiting_reply_since: "2026-10-30T10:00:00Z", no_reply_needed_at: null },
      { contact_id: A, platform: "instagram", assigned_to: null, last_message_at: null, last_message_preview: null, awaiting_reply_since: "2026-10-01T10:00:00Z", no_reply_needed_at: "2026-10-02T10:00:00Z" },
    ];
    const cells = conversationCells([A], ["chat_owner", "channels", "last_message", "awaiting"], rows)[A];
    expect(cells.chat_owner).toEqual({ t: "member", userId: B });
    expect(cells.channels).toEqual({ t: "list", items: ["Instagram", "WhatsApp"] });
    expect(cells.last_message).toEqual({ t: "date", at: "2026-11-02T10:00:00Z", mode: "relative", sub: "Hola" });
    expect(cells.awaiting).toEqual({ t: "date", at: "2026-10-30T10:00:00Z", mode: "relative", sub: "Esperando respuesta" });
  });
});

describe("secuencias y toques", () => {
  it("en la secuencia = inscripción activa o en pausa", () => {
    expect(plan({ secuencia: [A, "no-uuid"] })).toEqual({
      embeds: ["con_sequence_enrollments:sequence_enrollments!inner(sequence_id,status)"],
      clauses: [
        { op: "in", column: "con_sequence_enrollments.status", values: ["active", "paused"] },
        { op: "in", column: "con_sequence_enrollments.sequence_id", values: [A] },
      ],
    });
  });

  it("llegó por y anuncio de Meta van en el mismo join de toques", () => {
    expect(plan({ canal_origen: ["paid", "inventado"], meta: "si" })).toEqual({
      embeds: ["con_contact_touches:contact_touches!inner(channel,meta_ad_id)"],
      clauses: [
        { op: "in", column: "con_contact_touches.channel", values: ["paid"] },
        { op: "not_null", column: "con_contact_touches.meta_ad_id" },
      ],
    });
  });
});
