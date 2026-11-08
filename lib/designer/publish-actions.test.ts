import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDoc } from "./doc/schema";
import { MemoryDb } from "./testing/memory-db";

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER_WS = "99999999-2222-4333-8444-555555555555";
const DESIGN = "aaaaaaaa-2222-4333-8444-555555555555";
const USER = "77777777-2222-4333-8444-555555555555";

const h = vi.hoisted(() => ({
  permission: vi.fn(),
  service: vi.fn(),
}));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: h.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: h.service }));
// El audit y la cola van a la base simulada; el render, simulado.
vi.stubEnv("DESIGNER_FAKE_RENDER", "1");

import { exportStatus, publishDesign, requestExport, setPublicOptions, unpublishDesign, voidDesign } from "@/lib/actions/designer/publish";

const ctx = { workspace: { id: WS }, user: { id: USER } };
let db: MemoryDb;
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.principal.test");
  db = new MemoryDb({
    designs: [{ id: DESIGN, workspace_id: WS, name: "Certificado · Ana Pérez", format: "carta_h", doc: emptyDoc("carta_h"), template_id: "t1", code: "K8F2-WQ4M-7TQA", published: false, allow_download: true, allow_indexing: false, published_at: null, status: "ready", archived_at: null }],
    workspaces: [{ id: WS, scheduling_public_base_url: null }],
  });
  h.permission.mockReset();
  h.service.mockReset();
  h.service.mockResolvedValue(db);
});

const CALLS: { name: string; key: string; run: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "publishDesign", key: "designer.publish", run: () => publishDesign({ designId: DESIGN }) },
  { name: "unpublishDesign", key: "designer.publish", run: () => unpublishDesign({ designId: DESIGN }) },
  { name: "setPublicOptions", key: "designer.publish", run: () => setPublicOptions({ designId: DESIGN, allowDownload: false }) },
  { name: "requestExport", key: "designer.edit", run: () => requestExport({ kind: "design", id: DESIGN, exportKind: "pdf" }) },
  { name: "exportStatus", key: "designer.edit", run: () => exportStatus({ kind: "design", id: DESIGN, exportKind: "pdf", stamp: "1762516800000-abcd12" }) },
  { name: "voidDesign", key: "designer.generate", run: () => voidDesign({ designId: DESIGN, reason: "Duplicado" }) },
];

describe("cada acción valida su permiso adentro", () => {
  for (const call of CALLS) {
    it(`${call.name} pide ${call.key} y sin él no toca nada`, async () => {
      h.permission.mockResolvedValue(null);
      expect(await call.run()).toEqual({ ok: false, error: "No tenés permiso para hacer esto." });
      expect(h.permission).toHaveBeenCalledWith(call.key);
      expect(h.service).not.toHaveBeenCalled();
      expect(db.log).toHaveLength(0);
    });
  }

  it("un id que no es un uuid se rechaza antes de tocar la base", async () => {
    h.permission.mockResolvedValue(ctx);
    expect(await publishDesign({ designId: "no-es-un-uuid" })).toEqual({ ok: false, error: "El pedido no es válido." });
    expect(await voidDesign({ designId: DESIGN, reason: 7 as never })).toEqual({ ok: false, error: "El pedido no es válido." });
    expect(await requestExport({ kind: "otro" as never, id: DESIGN, exportKind: "pdf" })).toEqual({ ok: false, error: "El pedido no es válido." });
    expect(await requestExport({ kind: "design", id: DESIGN, exportKind: "pdf", page: -1 })).toEqual({ ok: false, error: "El pedido no es válido." });
    expect(h.service).not.toHaveBeenCalled();
  });
});

describe("con permiso, siempre sobre el negocio de la SESIÓN", () => {
  it("publicar y despublicar", async () => {
    h.permission.mockResolvedValue(ctx);
    expect(await publishDesign({ designId: DESIGN })).toEqual({ ok: true, data: { link: "https://app.principal.test/d/K8F2-WQ4M-7TQA" } });
    expect(db.rows("designs")[0].published).toBe(true);
    expect(await unpublishDesign({ designId: DESIGN })).toEqual({ ok: true, data: undefined });
    expect(db.rows("designs")[0].published).toBe(false);
  });

  it("anular, y el motivo queda guardado", async () => {
    h.permission.mockResolvedValue(ctx);
    expect(await voidDesign({ designId: DESIGN, reason: "Duplicado" })).toEqual({ ok: true, data: undefined });
    expect(db.rows("designs")[0]).toMatchObject({ status: "void", void_reason: "Duplicado", voided_by: USER });
  });

  it("alguien con permiso de OTRO negocio no puede tocar este diseño", async () => {
    h.permission.mockResolvedValue({ workspace: { id: OTHER_WS }, user: { id: USER } });
    for (const call of [() => publishDesign({ designId: DESIGN }), () => unpublishDesign({ designId: DESIGN }), () => setPublicOptions({ designId: DESIGN, allowDownload: false }), () => voidDesign({ designId: DESIGN, reason: "x" }), () => requestExport({ kind: "design", id: DESIGN, exportKind: "pdf" })]) {
      expect(await call()).toMatchObject({ ok: false, error: "No encontramos ese diseño." });
    }
    expect(db.log).toHaveLength(0);
  });

  it("pedir una exportación encola el render y responde «preparando»", async () => {
    h.permission.mockResolvedValue(ctx);
    const out = await requestExport({ kind: "design", id: DESIGN, exportKind: "zip" });
    expect(out).toMatchObject({ ok: true, data: { status: "preparing" } });
    expect(db.rows("scheduled_jobs")).toHaveLength(1);
  });
});

describe("el archivo de acciones", () => {
  const source = readFileSync(resolve(__dirname, "../actions/designer/publish.ts"), "utf8");

  it("es «use server» y solo exporta funciones asincrónicas", () => {
    expect(source.trimStart().startsWith('"use server"')).toBe(true);
    const exports = [...source.matchAll(/^export\s+(.*)$/gm)].map((m) => m[1]);
    expect(exports.length).toBe(6);
    for (const line of exports) expect(line).toMatch(/^async function /);
  });

  it("el negocio sale de la sesión: nunca se lee de lo que manda el navegador", () => {
    expect(source).not.toMatch(/input\.workspace|workspaceId:\s*input|parsed\.data\.workspace/);
    expect(source.match(/ctx\.workspace\.id/g)?.length).toBeGreaterThanOrEqual(6);
  });
});
