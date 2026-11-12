import { describe, expect, it } from "vitest";
import { chunks, planCompaction } from "./migraciones-compactadas.mjs";

// Un historial de juguete: 7 migraciones viejas (00000 a 00007, sin la 00004) y una foto de 3.
const manifest = {
  corte: "00007",
  foto: ["00000", "00001", "00002"],
  historicas: ["00000", "00001", "00002", "00003", "00005", "00006", "00007"].map((version) => ({ version, name: `m${version}` })),
};
const allOld = manifest.historicas.map((h) => h.version);

describe("planCompaction", () => {
  it("una base vacia no necesita nada: db push instala de cero", () => {
    const p = planCompaction({ manifest, remote: null, hasTables: false });
    expect(p.status).toBe("fresh");
    expect(p.revert).toEqual([]);
    expect(p.markApplied).toEqual([]);
  });

  it("un cliente al dia: saca del historial solo las viejas que no estan en la foto", () => {
    const p = planCompaction({ manifest, remote: allOld, hasTables: true });
    expect(p.status).toBe("ready");
    expect(p.revert).toEqual(["00003", "00005", "00006", "00007"]);
    expect(p.markApplied).toEqual([]);
  });

  it("nunca toca una migracion propia del cliente", () => {
    const p = planCompaction({ manifest, remote: [...allOld, "00042", "20990101000000"], hasTables: true });
    expect(p.status).toBe("ready");
    expect(p.revert).not.toContain("00042");
    expect(p.revert).not.toContain("20990101000000");
    expect(p.custom).toEqual(["00042", "20990101000000"]);
  });

  it("un cliente atrasado frena y no cambia nada", () => {
    const p = planCompaction({ manifest, remote: ["00000", "00001", "00002", "00003", "00005"], hasTables: true });
    expect(p.status).toBe("behind");
    expect(p.missing).toEqual(["00006", "00007"]);
    expect(p.revert).toEqual([]);
    expect(p.markApplied).toEqual([]);
    expect(p.message).toContain("v-historial-completo");
  });

  it("despues de arreglarlo (o una instalacion nueva) ya no hay nada que hacer", () => {
    expect(planCompaction({ manifest, remote: ["00000", "00001", "00002"], hasTables: true }).status).toBe("done");
    expect(planCompaction({ manifest, remote: ["00000", "00001", "00002", "00008"], hasTables: true }).status).toBe("done");
  });

  it("si falta anotar una de la foto (y las viejas ya no estan), solo la anota", () => {
    const p = planCompaction({ manifest, remote: ["00000", "00001"], hasTables: true });
    expect(p.status).toBe("ready");
    expect(p.revert).toEqual([]);
    expect(p.markApplied).toEqual(["00002"]);
  });

  it("una base pegada sin historial no se toca sin que la persona diga que estaba al dia", () => {
    const p = planCompaction({ manifest, remote: [], hasTables: true });
    expect(p.status).toBe("pasted_unknown");
    expect(p.markApplied).toEqual([]);
  });

  it("una base pegada al dia: se anota la foto como aplicada", () => {
    const p = planCompaction({ manifest, remote: null, hasTables: true, pastedUpToDate: true });
    expect(p.status).toBe("ready");
    expect(p.revert).toEqual([]);
    expect(p.markApplied).toEqual(["00000", "00001", "00002"]);
  });
});

describe("chunks", () => {
  it("parte la lista en tandas sin perder ninguna", () => {
    const list = Array.from({ length: 205 }, (_, i) => String(i));
    const parts = chunks(list, 80);
    expect(parts.map((p: string[]) => p.length)).toEqual([80, 80, 45]);
    expect(parts.flat()).toEqual(list);
  });
});
