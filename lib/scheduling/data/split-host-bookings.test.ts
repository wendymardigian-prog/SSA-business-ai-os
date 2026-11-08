import { describe, it, expect } from "vitest";
import { splitHostBookings } from "./slots-input";

const row = (id: string, released: string | null = null) => ({
  id,
  start_at: "2026-10-05T16:00:00.000Z",
  end_at: "2026-10-05T16:30:00.000Z",
  slot_released_at: released,
  event_types: { before_buffer_minutes: 5, after_buffer_minutes: 10 },
});

describe("splitHostBookings", () => {
  it("una reunión liberada no bloquea y su rango libera el ocupado de Google", () => {
    const out = splitHostBookings([row("a"), row("b", "2026-10-01T00:00:00.000Z")]);
    expect(out.bookings).toHaveLength(1);
    expect(out.bookings[0].after_buffer_minutes).toBe(10);
    expect(out.freed).toEqual([{ start_at: "2026-10-05T16:00:00.000Z", end_at: "2026-10-05T16:30:00.000Z" }]);
  });

  it("la reunión que se reagenda tampoco bloquea su propio horario", () => {
    const out = splitHostBookings([row("a")], "a");
    expect(out.bookings).toHaveLength(0);
    expect(out.freed).toHaveLength(1);
  });
});
