/**
 * Los avisos relativos de agenda van dirigidos a UN trigger (auditoria de automatizaciones, oct 2026).
 */
import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import "./index";
import { getTrigger } from "./registry";
import type { TriggerEventArgs } from "./types";

const booking = { id: "bk-1", event_type_id: "et-1", host_user_id: "u-1", origin: "public", status: "confirmed", category_snapshot: null, reschedule_count: 0 };
const args = (triggerId: string, payload: Record<string, unknown>): TriggerEventArgs =>
  ({
    supabase: fakeDb().client,
    event: { id: "ev-1", workspace_id: "ws1", event_type: "booking_before_start", contact_id: "ct1", payload },
    config: { offset_minutes: 60 },
    trigger: { id: triggerId } as never,
    booking,
  }) as unknown as TriggerEventArgs;

describe("booking_before_start", () => {
  const def = () => getTrigger("booking_before_start")!;
  it("el evento de un trigger NO dispara otro trigger del mismo tipo", async () => {
    expect(await def().eventMatches!(args("t-1h", { booking_id: "bk-1", trigger_id: "t-24h" }))).toBe(false);
    expect(await def().eventMatches!(args("t-24h", { booking_id: "bk-1", trigger_id: "t-24h" }))).toBe(true);
  });
  it("un evento sin trigger_id (viejo) sigue funcionando", async () => {
    expect(await def().eventMatches!(args("t-1h", { booking_id: "bk-1" }))).toBe(true);
  });
});
