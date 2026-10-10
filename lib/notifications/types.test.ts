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
    // La bandeja abre el hilo con ?c= (inbox/page.tsx). Con ?conversation= el
    // link abria la bandeja sin el hilo (Bloque 2d).
    expect(linkFor("conversation", "conv-1")).toBe("/dashboard/inbox?c=conv-1");
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

describe("linkFor para una pieza de contenido (Contenido v3)", () => {
  it("abre la pieza en el drawer del tablero, no en la ruta vieja que solo redirige", () => {
    expect(linkFor("content_post", "a4e752e4-f5ca-4891-86a4-b4257c06f6a0")).toBe(
      "/dashboard/content?piece=a4e752e4-f5ca-4891-86a4-b4257c06f6a0",
    );
  });

  it("sin id lleva al tablero", () => {
    expect(linkFor("content_post", null)).toBe("/dashboard/content");
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

describe("avisos de ventana de borradores (Bloque 2c)", () => {
  it("llevan a la cola filtrada por los que estan por vencer; los sin asignar, a ese bucket", () => {
    expect(linkFor("draft_queue", null, { unassigned: false })).toBe("/dashboard/drafts?ventana=por-vencer");
    expect(linkFor("draft_queue", null, { unassigned: true })).toBe("/dashboard/drafts?quien=sin-asignar&ventana=por-vencer");
  });
});

describe("avisos de Llamadas", () => {
  it("la conexion de Fathom lleva a Mi Fathom, no a Integraciones (un Member no entra ahi)", () => {
    expect(linkFor("fathom", null)).toBe("/dashboard/llamadas/mi-fathom");
  });
  it("una objecion abre la llamada; sin id, la lista", () => {
    expect(linkFor("call", "call-1")).toBe("/dashboard/llamadas/call-1");
    expect(linkFor("call", null)).toBe("/dashboard/llamadas");
  });
  it("son warning o info segun corresponde", () => {
    expect(toneFor("fathom_connection_error")).toBe("warning");
    expect(toneFor("call_analysis_budget")).toBe("warning");
    expect(toneFor("call_objection")).toBe("info");
  });
});
