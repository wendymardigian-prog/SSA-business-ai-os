import { describe, it, expect } from "vitest";
import {
  canScheduleNetwork,
  canUnschedule,
  MIN_LEAD_MINUTES,
  networkState,
  planSchedule,
  type ScheduleContext,
} from "./schedule";

const NOW = new Date("2026-09-26T12:00:00Z");
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60000).toISOString();

const context = (over: Partial<ScheduleContext> = {}): ScheduleContext => ({
  postStatus: "approved",
  perms: { publish: true },
  connected: ["instagram", "tiktok", "youtube"],
  defaultPublishers: { instagram: "zernio", tiktok: "zernio", youtube: "youtube_api" },
  existing: [],
  now: NOW,
  ...over,
});

const network = (platform: string, plannedAt: string | null = inMinutes(60)) => ({
  platform,
  plannedAt,
});

describe("programar una red (F25)", () => {
  it("con todo en orden, se programa", () => {
    expect(canScheduleNetwork(network("instagram"), context())).toEqual({
      ok: true,
      at: inMinutes(60),
      publisher: "zernio",
    });
  });

  it("sin permiso no se programa, y es lo primero que se dice", () => {
    const result = canScheduleNetwork(network("instagram"), context({ perms: { publish: false } }));

    expect(result).toEqual({ ok: false, error: expect.stringContaining("publicar") });
  });

  it("una pieza sin aprobar no se programa", () => {
    const result = canScheduleNetwork(network("instagram"), context({ postStatus: "draft" }));

    expect(result).toEqual({ ok: false, error: expect.stringContaining("aprobada") });
  });

  it("la red manda su publicador por encima del de la cuenta", () => {
    const result = canScheduleNetwork(
      { ...network("youtube"), publisher: "postproxy" },
      context(),
    );

    expect(result).toEqual({ ok: true, at: inMinutes(60), publisher: "postproxy" });
  });

  it("sin publicador en la red ni en la cuenta, no se programa (A1)", () => {
    // Sin esto la fila llega al despachador con el publicador vacio y queda
    // fallida para siempre, sin que nadie se entere.
    const result = canScheduleNetwork(
      network("instagram"),
      context({ defaultPublishers: { instagram: null } }),
    );

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Integraciones") });
  });

  it("en modo now sale en este momento, sin pedir anticipacion (A3)", () => {
    // "Publicar ahora" ponia la hora actual y despues la rechazaba por
    // "falta muy poco": era inalcanzable.
    const result = canScheduleNetwork(
      network("instagram", null),
      context({ mode: "now" }),
    );

    expect(result).toEqual({ ok: true, at: NOW.toISOString(), publisher: "zernio" });
  });

  it("en modo now una fecha vieja tampoco frena nada", () => {
    const result = canScheduleNetwork(
      network("instagram", inMinutes(-600)),
      context({ mode: "now" }),
    );

    expect(result.ok).toBe(true);
  });

  it("en modo now igual se piden permiso, aprobacion y cuenta", () => {
    expect(canScheduleNetwork(network("linkedin"), context({ mode: "now" })).ok).toBe(false);
    expect(
      canScheduleNetwork(network("instagram"), context({ mode: "now", perms: { publish: false } })).ok,
    ).toBe(false);
  });

  it("una red sin cuenta conectada dice donde conectarla", () => {
    const result = canScheduleNetwork(network("linkedin"), context());

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Integraciones") });
  });

  it("sin fecha no se programa", () => {
    expect(canScheduleNetwork(network("instagram", null), context()).ok).toBe(false);
  });

  it("una fecha pasada se rechaza", () => {
    const result = canScheduleNetwork(network("instagram", inMinutes(-10)), context());

    expect(result).toEqual({ ok: false, error: expect.stringContaining("ya paso") });
  });

  it("a menos de 5 minutos tampoco: la cola no llega", () => {
    const result = canScheduleNetwork(network("instagram", inMinutes(2)), context());

    expect(result).toEqual({ ok: false, error: expect.stringContaining(`${MIN_LEAD_MINUTES} minutos`) });
    expect(canScheduleNetwork(network("instagram", inMinutes(6)), context()).ok).toBe(true);
  });

  it("una red ya publicada no se vuelve a programar", () => {
    const result = canScheduleNetwork(
      network("instagram"),
      context({ existing: [{ platform: "instagram", status: "published", scheduledAt: null }] }),
    );

    expect(result).toEqual({ ok: false, error: expect.stringContaining("ya se publico") });
  });

  it("una red que esta saliendo en este momento tampoco", () => {
    const result = canScheduleNetwork(
      network("instagram"),
      context({ existing: [{ platform: "instagram", status: "publishing", scheduledAt: null }] }),
    );

    expect(result.ok).toBe(false);
  });

  it("una red fallida SI se puede volver a programar", () => {
    const result = canScheduleNetwork(
      network("instagram"),
      context({
        postStatus: "failed",
        existing: [{ platform: "instagram", status: "failed", scheduledAt: null }],
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("una pieza ya publicada admite programar OTRA red: es la redistribucion", () => {
    const result = canScheduleNetwork(
      network("youtube"),
      context({
        postStatus: "published",
        existing: [{ platform: "instagram", status: "published", scheduledAt: null }],
      }),
    );

    expect(result.ok).toBe(true);
  });
});

describe("programar varias a la vez", () => {
  it("las que se pueden se programan; las que no, con su motivo", () => {
    // Programar dos de tres es mejor que no programar ninguna.
    const plan = planSchedule(
      [network("instagram"), network("tiktok"), network("linkedin")],
      context(),
    );

    expect(plan.schedule.map((s) => s.platform)).toEqual(["instagram", "tiktok"]);
    expect(plan.skipped).toEqual([
      { platform: "linkedin", reason: expect.stringContaining("Integraciones") },
    ]);
  });

  it("una red sin fecha no aparece como saltada: todavia no entra", () => {
    const plan = planSchedule([network("instagram"), network("tiktok", null)], context());

    expect(plan.schedule).toHaveLength(1);
    expect(plan.skipped).toEqual([]);
  });

  it("sin ninguna red con fecha no se programa nada", () => {
    expect(planSchedule([network("instagram", null)], context())).toEqual({
      schedule: [],
      skipped: [],
    });
  });
});

describe("desprogramar", () => {
  const perms = { publish: true };

  it("conserva la fecha tentativa: es 'todavia no', no 'nunca'", () => {
    const result = canUnschedule(
      { platform: "instagram", status: "scheduled", scheduledAt: inMinutes(60) },
      perms,
      inMinutes(60),
    );

    expect(result).toEqual({ ok: true, keepsPlannedAt: inMinutes(60) });
  });

  it("lo ya publicado no se desprograma", () => {
    expect(
      canUnschedule({ platform: "instagram", status: "published", scheduledAt: null }, perms, null).ok,
    ).toBe(false);
  });

  it("lo que esta saliendo tampoco", () => {
    expect(
      canUnschedule({ platform: "instagram", status: "publishing", scheduledAt: null }, perms, null).ok,
    ).toBe(false);
  });

  it("sin permiso, no", () => {
    expect(
      canUnschedule(
        { platform: "instagram", status: "scheduled", scheduledAt: null },
        { publish: false },
        null,
      ).ok,
    ).toBe(false);
  });
});

describe("como se muestra el estado de cada red", () => {
  it("sin fecha, tentativa, programada, publicada", () => {
    expect(networkState(null, undefined)).toBe("no_date");
    expect(networkState(inMinutes(60), undefined)).toBe("tentative");
    expect(networkState(inMinutes(60), { platform: "x", status: "scheduled", scheduledAt: null })).toBe(
      "scheduled",
    );
    expect(networkState(null, { platform: "x", status: "published", scheduledAt: null })).toBe(
      "published",
    );
  });

  it("una publicacion cancelada vuelve a ser tentativa", () => {
    // Desprogramar no borra la fecha.
    expect(
      networkState(inMinutes(60), { platform: "x", status: "cancelled", scheduledAt: null }),
    ).toBe("tentative");
  });
});
