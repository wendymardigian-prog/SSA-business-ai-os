import { describe, it, expect } from "vitest";
import { summarizeMine } from "./mine";

const ME = "me";
const T = "2026-10-13";
const row = (over: Record<string, unknown>) => ({ owner_id: ME, status: "pending" as const, due_date: null as string | null, ...over });

describe("summarizeMine (F19)", () => {
  it("cuenta vencidas, de hoy y de los proximos 7 dias", () => {
    const s = summarizeMine(
      [
        row({ due_date: "2026-10-01" }),
        row({ due_date: "2026-10-12" }),
        row({ due_date: T }),
        row({ due_date: "2026-10-14" }),
        row({ due_date: "2026-10-20" }),
        row({ due_date: "2026-10-21" }),
        row({ due_date: null }),
      ],
      T,
      ME,
    );
    expect(s).toEqual({ overdue: 2, today: 1, next7: 2, open: 7 });
  });
  it("solo las mias y sin completar", () => {
    const s = summarizeMine([row({ due_date: T, owner_id: "otra" }), row({ due_date: T, status: "completed" }), row({ due_date: T, owner_id: null })], T, ME);
    expect(s).toEqual({ overdue: 0, today: 0, next7: 0, open: 0 });
  });
  it("sin tareas, todo en cero", () => {
    expect(summarizeMine([], T, ME)).toEqual({ overdue: 0, today: 0, next7: 0, open: 0 });
  });
  it("el limite de 7 dias cruza el fin de mes", () => {
    expect(summarizeMine([row({ due_date: "2026-11-02" })], "2026-10-26", ME).next7).toBe(1);
    expect(summarizeMine([row({ due_date: "2026-11-03" })], "2026-10-26", ME).next7).toBe(0);
  });
});
