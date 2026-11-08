import { beforeEach, describe, expect, it, vi } from "vitest";
import { shareMetadata } from "@/lib/og/share";
import { CODE, WS, DESIGN, publicDb, rpcDesign, rpcGeneration } from "../testing/public-fixtures";
import { loadPublicDesign, type PublicRecord } from "./load";
import { decidePublicView } from "./model";
import { designShare, previewSource } from "./share";

const MAIN = "https://app.principal.test";
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", MAIN));

async function record(rpc: Record<string, unknown>, workspace: Record<string, unknown> = {}, renders?: Record<string, unknown> | null): Promise<PublicRecord> {
  const { db } = publicDb({ rpc, workspace, ...(renders !== undefined ? { renders } : {}) });
  const loaded = await loadPublicDesign(db.client, CODE);
  if (!loaded) throw new Error("no cargó");
  return loaded;
}

describe("la tarjeta del link usa el dominio del negocio (V4)", () => {
  it("con dominio propio: og:url y la imagen empiezan con ese dominio", async () => {
    const r = await record(rpcDesign(), { scheduling_public_base_url: "https://links.negocio.test" });
    const meta = shareMetadata(designShare(r, decidePublicView(r.pub)));
    expect(meta.openGraph?.url).toBe(`https://links.negocio.test/d/${CODE}`);
    const image = (meta.openGraph?.images as { url: string }[])[0].url;
    expect(image.startsWith(`https://links.negocio.test/d/${CODE}/preview.png?v=`)).toBe(true);
    expect((meta.twitter?.images as string[])[0]).toBe(image);
  });

  it("sin dominio propio: el principal", async () => {
    const r = await record(rpcDesign());
    const meta = shareMetadata(designShare(r, decidePublicView(r.pub)));
    expect(meta.openGraph?.url).toBe(`${MAIN}/d/${CODE}`);
    expect((meta.openGraph?.images as { url: string }[])[0].url.startsWith(`${MAIN}/d/${CODE}/preview.png`)).toBe(true);
  });

  it("la marca es la del negocio del diseño, no la de la instalación", async () => {
    const r = await record(rpcDesign(), { brand_name: "Instituto Ejemplo" });
    expect(designShare(r, decidePublicView(r.pub)).brand.name).toBe("Instituto Ejemplo");
  });

  it("la URL de la imagen cambia cuando se vuelve a renderizar", async () => {
    const a = await record(rpcDesign({ rendered_version: "3-1" }));
    const b = await record(rpcDesign({ rendered_version: "4-9" }));
    expect(designShare(a, decidePublicView(a.pub)).version).not.toBe(designShare(b, decidePublicView(b.pub)).version);
  });

  it("mientras se prepara no se dice el nombre de la pieza", async () => {
    const r = await record(rpcGeneration({ status: "rendering", rendered: false, name: "Certificado · Ana Pérez" }));
    const share = designShare(r, decidePublicView(r.pub));
    expect(JSON.stringify(share)).not.toContain("Ana");
    expect(share.title).toBe("Diseño");
  });

  it("una pieza válida lleva el texto de verificación como descripción", async () => {
    const r = await record(rpcGeneration());
    expect(designShare(r, decidePublicView(r.pub)).description).toContain(`✅ Certificado válido · emitido por Academia Ejemplo`);
  });
});

describe("de dónde sale la imagen de la tarjeta", () => {
  it("la página 1 de los archivos de publicar, si hay", async () => {
    const r = await record(rpcDesign());
    expect(previewSource(r, decidePublicView(r.pub))).toEqual({ kind: "page", path: `${WS}/${DESIGN}/3-1/page-01.png` });
  });

  it("sin archivos, la imagen generada", async () => {
    const r = await record(rpcDesign({ rendered: false }), {}, null);
    expect(previewSource(r, decidePublicView(r.pub))).toEqual({ kind: "generated" });
  });

  it("anulada o en preparación: la generada", async () => {
    const voided = await record(rpcGeneration({ status: "void", void_reason: "Error" }));
    expect(previewSource(voided, decidePublicView(voided.pub))).toEqual({ kind: "generated" });
    const preparing = await record(rpcGeneration({ status: "queued", rendered: false }));
    expect(previewSource(preparing, decidePublicView(preparing.pub))).toEqual({ kind: "generated" });
  });
});
