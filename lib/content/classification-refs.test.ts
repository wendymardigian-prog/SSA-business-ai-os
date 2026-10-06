import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { checkTaxonomyRefs } from "./classification-refs";

const WS = "ws-1";

const seed = () =>
  memoryDb({
    content_pillars: [
      { id: "p-ok", workspace_id: WS, name: "Educativo", archived_at: null },
      { id: "p-arch", workspace_id: WS, name: "Viejo", archived_at: "2026-10-01T00:00:00Z" },
      { id: "p-ajeno", workspace_id: "otro-ws", name: "Ajeno", archived_at: null },
    ],
    content_offers: [
      { id: "o-ok", workspace_id: WS, name: "Mentoria", archived_at: null },
      { id: "o-arch", workspace_id: WS, name: "Vieja", archived_at: "2026-10-01T00:00:00Z" },
    ],
  });

describe("checkTaxonomyRefs (F91)", () => {
  it("acepta un pilar y una oferta activos del workspace", async () => {
    const db = seed();
    expect(await checkTaxonomyRefs(db.client as never, WS, { pillar_id: "p-ok", offer_id: "o-ok" })).toEqual({ ok: true });
  });

  it("sin pilar ni oferta no hay nada que revisar", async () => {
    const db = seed();
    expect(await checkTaxonomyRefs(db.client as never, WS, {})).toEqual({ ok: true });
    expect(await checkTaxonomyRefs(db.client as never, WS, { pillar_id: null, offer_id: null })).toEqual({ ok: true });
  });

  it("rechaza un pilar de OTRO workspace", async () => {
    const db = seed();
    const r = await checkTaxonomyRefs(db.client as never, WS, { pillar_id: "p-ajeno" });
    expect(r).toMatchObject({ ok: false });
  });

  it("rechaza un id que no existe", async () => {
    const db = seed();
    expect(await checkTaxonomyRefs(db.client as never, WS, { offer_id: "nada" })).toMatchObject({ ok: false });
  });

  it("rechaza elegir un archivado NUEVO, con el articulo bien", async () => {
    const db = seed();
    const pilar = await checkTaxonomyRefs(db.client as never, WS, { pillar_id: "p-arch" });
    const oferta = await checkTaxonomyRefs(db.client as never, WS, { offer_id: "o-arch" });

    expect(pilar).toMatchObject({ ok: false, error: expect.stringContaining("archivado") });
    expect(oferta).toMatchObject({ ok: false, error: expect.stringContaining("archivada") });
  });

  it("pero acepta el archivado que la fila YA tenia: guardar una pieza vieja no falla", async () => {
    const db = seed();
    expect(
      await checkTaxonomyRefs(db.client as never, WS, { pillar_id: "p-arch" }, { pillar_id: "p-arch" }),
    ).toEqual({ ok: true });
  });

  it("y si cambia a otro archivado distinto del que tenia, no", async () => {
    const db = seed();
    expect(
      await checkTaxonomyRefs(db.client as never, WS, { offer_id: "o-arch" }, { offer_id: "o-ok" }),
    ).toMatchObject({ ok: false });
  });
});
