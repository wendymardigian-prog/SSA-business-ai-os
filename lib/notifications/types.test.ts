import { describe, it, expect } from "vitest";
import {
  linkFor,
  relativeTime,
  toneFor,
  isNotificationType,
  NOTIFICATION_TYPES,
  NOTIFICATION_DEFINITIONS,
} from "./types";

describe("catalogo", () => {
  it("cada tipo tiene definicion y no hay huerfanos", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_DEFINITIONS[type]?.type).toBe(type);
    }
    expect(Object.keys(NOTIFICATION_DEFINITIONS).sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });

  it("reconoce los tipos conocidos y rechaza los inventados", () => {
    expect(isNotificationType("human_takeover")).toBe(true);
    expect(isNotificationType("cualquier_cosa")).toBe(false);
  });

  it("un tipo desconocido no rompe: cae a info", () => {
    // La base no tiene CHECK en `type`, asi que una version vieja del front
    // puede encontrarse con un tipo que no conoce.
    expect(toneFor("un_tipo_del_futuro")).toBe("info");
    expect(toneFor("human_takeover")).toBe("warning");
  });
});

describe("linkFor", () => {
  it("una derivacion lleva a la conversacion", () => {
    expect(linkFor("conversation", "conv-1")).toBe("/dashboard/inbox?conversation=conv-1");
  });

  it("un canal caido lleva a Canales", () => {
    expect(linkFor("channel", "chan-1")).toBe("/dashboard/channels");
  });

  it("una colision lleva a la secuencia, que es donde se resuelve", () => {
    // La inscripcion no tiene pantalla propia; el id de la secuencia viene en
    // el metadata justamente para esto.
    expect(linkFor("sequence_enrollment", "enr-1", { sequence_id: "seq-1" })).toBe(
      "/dashboard/sequences/seq-1",
    );
  });

  it("sin el id de la secuencia cae al listado en vez de a un 404", () => {
    expect(linkFor("sequence_enrollment", "enr-1", {})).toBe("/dashboard/sequences");
  });

  it("sin entidad no hay link: se muestra igual, sin llevar a ningun lado", () => {
    expect(linkFor(null, null)).toBeNull();
    expect(linkFor("algo_desconocido", "x")).toBeNull();
  });
});

describe("relativeTime", () => {
  const ahora = new Date("2026-09-10T12:00:00Z");
  const hace = (ms: number) => new Date(ahora.getTime() - ms).toISOString();

  it("dice el tiempo en castellano y en singular/plural", () => {
    expect(relativeTime(hace(10_000), ahora)).toBe("recien");
    expect(relativeTime(hace(60_000), ahora)).toBe("hace 1 minuto");
    expect(relativeTime(hace(5 * 60_000), ahora)).toBe("hace 5 minutos");
    expect(relativeTime(hace(3600_000), ahora)).toBe("hace 1 hora");
    expect(relativeTime(hace(5 * 3600_000), ahora)).toBe("hace 5 horas");
    expect(relativeTime(hace(24 * 3600_000), ahora)).toBe("ayer");
    expect(relativeTime(hace(5 * 24 * 3600_000), ahora)).toBe("hace 5 dias");
    expect(relativeTime(hace(60 * 24 * 3600_000), ahora)).toBe("hace 2 meses");
  });

  it("una fecha rota no rompe la campana", () => {
    expect(relativeTime("no es una fecha", ahora)).toBe("");
  });
});
