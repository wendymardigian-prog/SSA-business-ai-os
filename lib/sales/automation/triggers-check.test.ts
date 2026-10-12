/**
 * La 00166 suma los 6 tipos de Ventas al CHECK de `triggers.type` y NO quita ninguno de los 24
 * que ya había (incluidos los de Llamadas y Formularios). Lee el archivo de la migración.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/00166_sales_trigger_types.sql", "utf8");
const live = sql.slice(sql.indexOf("ADD CONSTRAINT triggers_type_check"));
const typesIn = (text: string) => [...text.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);

const PREVIOUS_24 = [
  "keyword", "postback", "quick_reply", "welcome", "default", "comment_keyword", "new_contact", "crm_event", "inactivity", "email_received",
  "booking_created", "booking_rescheduled", "booking_cancelled", "booking_updated", "booking_ended", "booking_status_changed", "booking_before_start", "booking_after_end", "booking_after_created",
  "call_analyzed", "call_linked", "form_submitted", "survey_answered", "contract_signed",
];
const SALES_6 = ["sale_created", "sale_status_changed", "payment_created", "payment_status_changed", "payment_before_due", "payment_after_due"];

describe("00166: triggers.type", () => {
  it("el CHECK nuevo tiene los 24 de antes y los 6 de Ventas, sin repetidos", () => {
    const now = typesIn(live);
    expect(now).toHaveLength(30);
    expect(new Set(now).size).toBe(30);
    for (const t of [...PREVIOUS_24, ...SALES_6]) expect(now).toContain(t);
  });

  it("la cabecera guarda la lista vieja completa para volver atrás", () => {
    const header = sql.slice(0, sql.indexOf("ALTER TABLE public.triggers DROP"));
    expect(typesIn(header)).toEqual(PREVIOUS_24);
  });
});
