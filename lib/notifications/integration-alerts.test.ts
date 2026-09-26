import { describe, it, expect, vi, beforeEach } from "vitest";

const { createNotificationOnce } = vi.hoisted(() => ({ createNotificationOnce: vi.fn() }));
vi.mock("./create", () => ({ createNotificationOnce }));

import {
  ALERT_WINDOW_MINUTES,
  alertEntityId,
  alertTitle,
  notifyIntegrationAttention,
} from "./integration-alerts";

const supabase = {} as never;
const base = {
  supabase,
  workspaceId: "ws-1",
  providerId: "google",
  providerLabel: "Google (YouTube)",
  detail: "El acceso vence en 3 dias.",
};

beforeEach(() => {
  vi.clearAllMocks();
  createNotificationOnce.mockResolvedValue(true);
});

describe("avisos de integraciones (F15)", () => {
  it("el aviso dice que integracion y que pasa", async () => {
    await notifyIntegrationAttention({ ...base, cause: "expiring" });

    expect(createNotificationOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "integration_attention",
        title: "La conexion con Google (YouTube) esta por vencer",
        body: "El acceso vence en 3 dias.",
        entityType: "integration",
        metadata: { provider: "google", cause: "expiring" },
      }),
    );
  });

  it("cada causa tiene su ventana de repeticion", async () => {
    await notifyIntegrationAttention({ ...base, cause: "expiring" });
    expect(createNotificationOnce.mock.calls[0][0].withinMinutes).toBe(3 * 24 * 60);

    await notifyIntegrationAttention({ ...base, cause: "quota" });
    expect(createNotificationOnce.mock.calls[1][0].withinMinutes).toBe(24 * 60);
  });

  it("todas las causas tienen ventana y titulo", () => {
    for (const cause of ["expiring", "revoked", "missing_scope", "quota"] as const) {
      expect(ALERT_WINDOW_MINUTES[cause]).toBeGreaterThan(0);
      expect(alertTitle("Postproxy", cause)).toContain("Postproxy");
    }
  });
});

describe("el id que evita el aviso repetido", () => {
  it("es un uuid: la columna no acepta otra cosa", () => {
    expect(alertEntityId("google", "expiring")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("el mismo proveedor y la misma causa dan siempre el mismo id", () => {
    expect(alertEntityId("google", "expiring")).toBe(alertEntityId("google", "expiring"));
  });

  it("distinta causa o distinto proveedor dan ids distintos", () => {
    // Si compartieran id, el aviso de que falta un permiso taparia el de que
    // se llego al tope.
    const ids = new Set([
      alertEntityId("google", "expiring"),
      alertEntityId("google", "missing_scope"),
      alertEntityId("postproxy", "quota"),
      alertEntityId("postproxy", "expiring"),
    ]);

    expect(ids.size).toBe(4);
  });
});
