import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { notifyBooking } from "./notifications";

const created = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications/create", () => ({ createNotification: created }));

const BOOKING = {
  id: "b-1",
  workspace_id: "ws-1",
  host_user_id: "host-1",
  title: "Llamada",
  // 01:30 UTC del 5: todavia es el 4 a la noche en Buenos Aires.
  start_at: "2026-11-05T01:30:00.000Z",
  host_timezone: "Asia/Tokyo",
  booker_name: "Ana",
};

function fakeService(prefTimezone: string | null): SupabaseClient<Database> {
  const row = (table: string) => (table === "bookings" ? BOOKING : prefTimezone ? { timezone: prefTimezone } : null);
  return {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row(table), error: null }) }) }),
    }),
  } as unknown as SupabaseClient<Database>;
}

const bodyOf = () => created.mock.calls[0][0].body as string;

describe("notifyBooking: la fecha del aviso", () => {
  beforeEach(() => created.mockReset());

  it("va en la zona de la persona que lo recibe, no en la de su perfil de agenda", async () => {
    await notifyBooking(fakeService("America/Argentina/Buenos_Aires"), "b-1", "booking_created");
    expect(bodyOf()).toMatch(/22:30/);
    expect(bodyOf()).not.toMatch(/10:30/);
  });

  it("sin preferencia guardada (o invalida), usa la zona de la reunion", async () => {
    await notifyBooking(fakeService(null), "b-1", "booking_created");
    expect(bodyOf()).toMatch(/10:30/);

    created.mockReset();
    await notifyBooking(fakeService("Marte/Olympus"), "b-1", "booking_created");
    expect(bodyOf()).toMatch(/10:30/);
  });

  it("quien hizo la accion no se avisa a si mismo", async () => {
    await notifyBooking(fakeService("UTC"), "b-1", "booking_created", { actorUserId: "host-1" });
    expect(created).not.toHaveBeenCalled();
  });
});
