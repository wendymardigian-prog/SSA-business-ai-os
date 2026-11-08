import { describe, expect, it, vi } from "vitest";
import { emptyDoc } from "./doc/schema";
import { MAX_VOID_REASON } from "./publishing-limits";
import { voidDesignCore, type Actor, type PublishingDeps } from "./publishing";
import { decidePublicView } from "./public/model";
import { loadPublicDesign } from "./public/load";
import { serveDownload, servePageImage } from "./public/serve";
import { CODE, DESIGN, WS, publicDb, rpcGeneration } from "./testing/public-fixtures";
import { MemoryDb, type Row } from "./testing/memory-db";

const NOW = new Date("2026-11-08T10:00:00Z");
const USER = "99999999-2222-3333-4444-555555555555";
const actor: Actor = { workspaceId: WS, userId: USER };
const DOC = emptyDoc("carta_h");

const seed = (design: Row = {}) =>
  new MemoryDb({
    designs: [{ id: DESIGN, workspace_id: WS, name: "Certificado · Ana Pérez", format: "carta_h", doc: DOC, template_id: "t1", code: CODE, published: false, allow_download: true, allow_indexing: false, published_at: null, status: "ready", archived_at: null, void_reason: null, voided_at: null, voided_by: null, ...design }],
  });
const deps = () => ({ audit: vi.fn(async (..._args: unknown[]) => "a1" as string | null), now: () => NOW }) satisfies PublishingDeps;
const row = (db: MemoryDb) => db.rows("designs")[0];

describe("anular una generación (F47)", () => {
  it("sin motivo se rechaza, y no se escribe nada", async () => {
    for (const reason of ["", "   ", "\n\t "]) {
      const db = seed();
      const d = deps();
      expect(await voidDesignCore(db.client, actor, { designId: DESIGN, reason }, d)).toEqual({ ok: false, error: "Escribí el motivo de la anulación." });
      expect(row(db).status).toBe("ready");
      expect(db.log).toHaveLength(0);
      expect(d.audit).not.toHaveBeenCalled();
    }
  });

  it("un motivo larguísimo se rechaza con un mensaje claro", async () => {
    const out = await voidDesignCore(seed().client, actor, { designId: DESIGN, reason: "x".repeat(MAX_VOID_REASON + 1) }, deps());
    expect(out).toEqual({ ok: false, error: `El motivo es demasiado largo (hasta ${MAX_VOID_REASON} caracteres).` });
  });

  it("anula: queda `void` con su motivo, quién y cuándo; y NUNCA se borra", async () => {
    const db = seed();
    const d = deps();
    expect(await voidDesignCore(db.client, actor, { designId: DESIGN, reason: "  Nombre mal escrito  " }, d)).toEqual({ ok: true, data: undefined });
    expect(row(db)).toMatchObject({ status: "void", void_reason: "Nombre mal escrito", voided_at: NOW.toISOString(), voided_by: USER, code: CODE });
    expect(db.rows("designs")).toHaveLength(1);
    expect(db.log.some((entry) => entry.op === "delete")).toBe(false);
  });

  it("queda en el historial del negocio con el motivo", async () => {
    const d = deps();
    await voidDesignCore(seed().client, actor, { designId: DESIGN, reason: "Duplicado" }, d);
    const call = d.audit.mock.calls[0][0] as { workspaceId: string; entityType: string; entityId: string; performedBy: string; changes: unknown; metadata: unknown };
    expect(call).toMatchObject({ workspaceId: WS, entityType: "design", entityId: DESIGN, performedBy: USER, metadata: { event: "design.voided", kind: "generation" } });
    expect(call.changes).toEqual({ status: { old: "ready", new: "void" }, void_reason: { old: null, new: "Duplicado" } });
  });

  it("solo una generación: un diseño propio no se anula", async () => {
    const db = seed({ template_id: null });
    expect(await voidDesignCore(db.client, actor, { designId: DESIGN, reason: "x" }, deps())).toEqual({ ok: false, error: "Solo se puede anular una pieza generada desde una plantilla." });
    expect(row(db).status).toBe("ready");
  });

  it("una ya anulada no se anula de nuevo (no pisa el motivo)", async () => {
    const db = seed({ status: "void", void_reason: "Primero" });
    expect(await voidDesignCore(db.client, actor, { designId: DESIGN, reason: "Segundo" }, deps())).toEqual({ ok: false, error: "Esa pieza ya está anulada." });
    expect(row(db).void_reason).toBe("Primero");
  });

  it("solo se anula una pieza que ya está lista (una que se está generando se pisaría con «lista»)", async () => {
    for (const status of ["queued", "rendering", "failed", "draft"]) {
      const db = seed({ status });
      expect((await voidDesignCore(db.client, actor, { designId: DESIGN, reason: "x" }, deps())).ok).toBe(false);
      expect(row(db).status).toBe(status);
    }
  });

  it("si cambió de estado entre que se leyó y que se escribió, no se pisa", async () => {
    const db = seed();
    db.onSelect = (table) => {
      if (table === "designs") row(db).status = "rendering";
    };
    const out = await voidDesignCore(db.client, actor, { designId: DESIGN, reason: "x" }, deps());
    expect(out).toEqual({ ok: false, error: "La pieza cambió mientras tanto. Recargá y probá de nuevo." });
    expect(row(db).status).toBe("rendering");
  });

  it("una pieza de OTRO negocio es «no existe»", async () => {
    const db = seed({ workspace_id: "99999999-0000-0000-0000-000000000000" });
    const d = deps();
    expect(await voidDesignCore(db.client, actor, { designId: DESIGN, reason: "x" }, d)).toEqual({ ok: false, error: "No encontramos ese diseño." });
    expect(row(db).status).toBe("ready");
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("si la base falla, se dice claro y no queda a medias", async () => {
    const db = seed();
    db.failures.set("designs.update", "caída");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await voidDesignCore(db.client, actor, { designId: DESIGN, reason: "x" }, deps())).toEqual({ ok: false, error: "No se pudo anular. Probá de nuevo." });
    expect(row(db).status).toBe("ready");
    spy.mockRestore();
  });
});

describe("después de anular, el link muestra «anulado» con el motivo y sin Descargar", () => {
  it("de punta a punta: anular → el link de afuera", async () => {
    const { db } = publicDb({ rpc: null });
    Object.assign(db.rows("designs")[0], { workspace_id: WS, name: "Certificado · Ana Pérez", format: "carta_h", doc: DOC, template_id: "t1", published: false, allow_download: true, allow_indexing: false, status: "ready", archived_at: null });
    // `design_public_get` para una generación con verificación (la regla de la base: se ve aunque no esté publicada).
    db.rpcs.design_public_get = () => {
      const r = db.rows("designs")[0];
      return rpcGeneration({ status: r.status, void_reason: r.status === "void" ? r.void_reason : null });
    };
    const request = (path: string) => new Request(`https://links.test${path}`, { headers: { "x-real-ip": "203.0.113.9" } });
    const quick = { notFound: async () => new Response(null, { status: 404 }) };

    const valid = decidePublicView((await loadPublicDesign(db.client, CODE))!.pub);
    expect(valid.verification?.status).toBe("valid");
    expect(valid.download.allowed).toBe(true);
    expect((await serveDownload(db.client, request(`/d/${CODE}/descargar?formato=pdf`), CODE, quick)).status).toBe(200);

    expect((await voidDesignCore(db.client, actor, { designId: DESIGN, reason: "Nombre mal escrito" }, deps())).ok).toBe(true);

    const record = (await loadPublicDesign(db.client, CODE))!;
    const view = decidePublicView(record.pub);
    expect(view.verification).toMatchObject({ status: "void", text: "⛔ Certificado anulado · Motivo: Nombre mal escrito" });
    expect(view.voidStamp).toBe(true);
    expect(view.download).toEqual({ allowed: false, ready: false, option: null });
    // No hay botón y la ruta tampoco la entrega.
    expect((await serveDownload(db.client, request(`/d/${CODE}/descargar?formato=pdf`), CODE, quick)).status).toBe(404);
    // La pieza se sigue viendo (con su sello).
    expect((await servePageImage(db.client, request(`/d/${CODE}/p/1`), CODE, "1", quick)).status).toBe(200);
  });
});
