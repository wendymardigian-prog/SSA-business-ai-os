import { describe, it, expect } from "vitest";
import { planDispatch } from "./plan";
import { DEFAULT_BACKGROUND_SETTINGS } from "./settings";

const TZ = "America/Costa_Rica";
const now = new Date("2026-09-16T10:00:00Z"); // 04:00 CR

describe("planDispatch (F24)", () => {
  it("solo despacha tareas en modo económico con ventana vencida", () => {
    // default: message_classification batch daily 03:00 → 04:00 CR ya pasó.
    const p = planDispatch("ws-1", DEFAULT_BACKGROUND_SETTINGS, now, TZ);
    expect(p).toHaveLength(1);
    expect(p[0].task).toBe("message_classification");
    expect(p[0].dedupeKey).toBe("bg:ws-1:message_classification:2026-09-16");
  });
  it("una tarea en Inmediato no se despacha", () => {
    const s = { ...DEFAULT_BACKGROUND_SETTINGS, message_classification: { mode: "now" as const } };
    expect(planDispatch("ws-1", s, now, TZ)).toHaveLength(0);
  });
  it("correr dos veces da el mismo dedupe_key (idempotente)", () => {
    const a = planDispatch("ws-1", DEFAULT_BACKGROUND_SETTINGS, now, TZ);
    const b = planDispatch("ws-1", DEFAULT_BACKGROUND_SETTINGS, new Date("2026-09-16T10:14:00Z"), TZ);
    expect(a[0].dedupeKey).toBe(b[0].dedupeKey);
  });
});
