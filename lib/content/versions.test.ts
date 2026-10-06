import { describe, it, expect } from "vitest";
import {
  compareVersions,
  describeVersion,
  IDLE_MINUTES,
  MAX_VERSIONS_PER_POST,
  nextVersionNumber,
  versionReasonFor,
  versionsToPrune,
  type PostSnapshot,
  type StoredVersion,
} from "./versions";

const NOW = new Date("2026-09-26T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();

const snapshot = (over: Partial<PostSnapshot> = {}): PostSnapshot => ({
  title: "Una pieza",
  format: "reel",
  script: "Hola\n\nCuerpo",
  recording_notes: null,
  caption: "Un caption",
  networks: [],
  media: [],
  ...over,
});

describe("cuando se guarda una version (F22)", () => {
  it("el autoguardado normal NO deja version", () => {
    // Cada 10 segundos: el historial quedaria inservible.
    expect(versionReasonFor({ trigger: "autosave", lastEditedAt: minutesAgo(1), now: NOW })).toBeNull();
  });

  it("volver despues de un rato si deja version", () => {
    expect(versionReasonFor({ trigger: "autosave", lastEditedAt: minutesAgo(IDLE_MINUTES), now: NOW })).toBe(
      "resume_after_idle",
    );
  });

  it("cambiar de estado, guardar a mano, generar con IA y restaurar siempre dejan", () => {
    expect(versionReasonFor({ trigger: "status_change" })).toBe("status_change");
    expect(versionReasonFor({ trigger: "manual_save" })).toBe("manual_save");
    expect(versionReasonFor({ trigger: "ai_generation" })).toBe("ai_generation");
    expect(versionReasonFor({ trigger: "restore" })).toBe("restore");
  });

  it("un autoguardado sin edicion previa no deja version", () => {
    expect(versionReasonFor({ trigger: "autosave", lastEditedAt: null, now: NOW })).toBeNull();
    expect(versionReasonFor({ trigger: "autosave", lastEditedAt: "roto", now: NOW })).toBeNull();
  });
});

describe("numeracion y recorte", () => {
  it("la version nueva es la siguiente", () => {
    expect(nextVersionNumber(0)).toBe(1);
    expect(nextVersionNumber(7)).toBe(8);
  });

  it("hasta 50 no se borra nada", () => {
    const versions = Array.from({ length: MAX_VERSIONS_PER_POST }, (_, i) => ({
      id: `v${i}`,
      version_no: i + 1,
    }));

    expect(versionsToPrune(versions)).toEqual([]);
  });

  it("con 51 se borra la mas vieja, no la ultima", () => {
    const versions = Array.from({ length: MAX_VERSIONS_PER_POST + 1 }, (_, i) => ({
      id: `v${i}`,
      version_no: i + 1,
    }));

    expect(versionsToPrune(versions)).toEqual(["v0"]);
  });

  it("con muchas de mas, se borran todas las viejas de una", () => {
    const versions = Array.from({ length: 55 }, (_, i) => ({ id: `v${i}`, version_no: i + 1 }));

    expect(versionsToPrune(versions)).toHaveLength(5);
    expect(versionsToPrune(versions)).toContain("v0");
    expect(versionsToPrune(versions)).not.toContain("v54");
  });

  it("el orden de entrada no importa", () => {
    const desordenadas = [
      { id: "nueva", version_no: 3 },
      { id: "vieja", version_no: 1 },
      { id: "media", version_no: 2 },
    ];

    expect(versionsToPrune(desordenadas, 2)).toEqual(["vieja"]);
  });
});

describe("comparar dos versiones", () => {
  it("muestra solo lo que cambio", () => {
    const diffs = compareVersions(snapshot(), snapshot({ title: "Otro titulo" }));

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ field: "title", before: "Una pieza", after: "Otro titulo" });
  });

  it("compara el guion y las notas de grabacion por separado", () => {
    const diffs = compareVersions(
      snapshot(),
      snapshot({ script: "Hola\n\nOtro cuerpo", recording_notes: "Plano medio" }),
    );

    expect(diffs.map((d) => d.field)).toEqual(["script", "recording_notes"]);
    expect(diffs[0].label).toBe("Guion");
    expect(diffs[1].label).toBe("Notas de grabacion");
  });

  it("de redes y media dice cuantas, no un diff de JSON", () => {
    // Un diff linea a linea de un jsonb no le dice nada a nadie.
    const diffs = compareVersions(snapshot(), snapshot({ media: [{ a: 1 }, { b: 2 }] }));

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ field: "media", before: "0 elemento(s)", after: "2 elemento(s)" });
  });

  it("dos versiones iguales no muestran nada", () => {
    expect(compareVersions(snapshot(), snapshot())).toEqual([]);
  });

  it("un campo que pasa de vacio a null no cuenta como cambio", () => {
    expect(compareVersions(snapshot({ caption: null }), snapshot({ caption: "" }))).toEqual([]);
  });
});

describe("como se lee cada version en el historial", () => {
  const version = (over: Partial<StoredVersion> = {}): StoredVersion => ({
    id: "v1",
    version_no: 1,
    snapshot: snapshot(),
    author_kind: "human",
    author_id: "u1",
    reason: "manual_save",
    created_at: NOW.toISOString(),
    ...over,
  });

  it("dice quien y por que", () => {
    expect(describeVersion(version(), "Wendy")).toBe("Guardada por Wendy");
    expect(describeVersion(version({ reason: "ai_generation", author_kind: "ai" }))).toBe(
      "Generada con IA",
    );
    expect(describeVersion(version({ reason: "resume_after_idle" }), "Wendy")).toContain("retomar");
  });

  it("sin nombre, no queda un hueco", () => {
    expect(describeVersion(version())).toBe("Guardada por alguien del equipo");
  });
});
