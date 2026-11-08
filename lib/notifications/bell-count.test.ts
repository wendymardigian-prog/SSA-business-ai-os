import { beforeEach, describe, expect, it, vi } from "vitest";
import { BELL_BADGE_MAX, BELL_COUNT_CAP, bellAriaLabel, bellBadgeText } from "./bell-count";

const USER = "0b8f2f8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const WS = "1c9e3a7f-2d3e-4f5a-9b0c-1d2e3f4a5b6c";

// Lo que la base devuelve y lo que se le pidio (la cadena de PostgREST, simulada).
let rows: Array<{ id: string }> = [];
let calls: Array<[string, unknown[]]> = [];

function builder() {
  const b: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ["from", "select", "eq", "is", "or", "not", "order"]) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return b;
    };
  }
  b.limit = (...args: unknown[]) => {
    calls.push(["limit", args]);
    return Promise.resolve({ data: rows.slice(0, args[0] as number), error: null });
  };
  return b;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ supabase: builder(), workspace: { id: WS }, user: { id: USER } }),
}));
vi.mock("@/lib/account/notification-prefs", () => ({ getMyNotificationPrefs: async () => ({}) }));
vi.mock("@/lib/notifications/preferences", () => ({ mutedBellTypes: () => ["task_due_today"] }));

describe("el numerito de la campana", () => {
  it("de 1 a 9 el numero; desde 10, «9+»", () => {
    expect(bellBadgeText(1)).toBe("1");
    expect(bellBadgeText(9)).toBe("9");
    expect(bellBadgeText(10)).toBe("9+");
    expect(bellBadgeText(956)).toBe("9+");
  });

  it("el texto para lectores de pantalla tiene el mismo tope", () => {
    expect(bellAriaLabel(0)).toBe("Notificaciones, ninguna sin leer");
    expect(bellAriaLabel(3)).toBe("Notificaciones, 3 sin leer");
    expect(bellAriaLabel(10)).toBe("Notificaciones, más de 9 sin leer");
  });

  it("se lee una fila mas de lo que se muestra: alcanza para saber si va «9+»", () => {
    expect(BELL_COUNT_CAP).toBe(BELL_BADGE_MAX + 1);
  });
});

describe("countUnreadNotifications", () => {
  beforeEach(() => {
    calls = [];
    rows = [];
  });

  it("pide como mucho BELL_COUNT_CAP filas, sin conteo exacto, y con los mismos filtros de siempre", async () => {
    rows = Array.from({ length: 956 }, (_, i) => ({ id: `n${i}` }));
    const { countUnreadNotifications } = await import("@/lib/actions/notifications");

    expect(await countUnreadNotifications()).toBe(BELL_COUNT_CAP);

    // Sin `count: "exact"`: ese conteo evaluaba la RLS en cada aviso sin leer.
    const select = calls.find(([m]) => m === "select");
    expect(select?.[1]).toEqual(["id"]);
    expect(calls).toContainEqual(["from", ["notifications"]]);
    expect(calls).toContainEqual(["eq", ["workspace_id", WS]]);
    expect(calls).toContainEqual(["is", ["read_at", null]]);
    expect(calls).toContainEqual(["or", [`recipient_id.eq.${USER},recipient_id.is.null`]]);
    expect(calls).toContainEqual(["not", ["type", "in", "(task_due_today)"]]);
    expect(calls).toContainEqual(["order", ["created_at", { ascending: false }]]);
    expect(calls).toContainEqual(["limit", [BELL_COUNT_CAP]]);
  });

  it("con pocas sin leer devuelve el numero justo", async () => {
    rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { countUnreadNotifications } = await import("@/lib/actions/notifications");
    expect(await countUnreadNotifications()).toBe(3);
  });
});
