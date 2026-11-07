/**
 * Datos de prueba del link público: lo que devuelve `design_public_get` y un `MemoryDb` ya armado con un diseño
 * publicado, su negocio y sus archivos. Solo para tests. Nombres inventados.
 */

import { MemoryDb } from "./memory-db";

export const WS = "11111111-2222-3333-4444-555555555555";
export const DESIGN = "aaaaaaaa-2222-3333-4444-555555555555";
export const CODE = "K8F2-WQ4M-7TQA";

/** Lo que devuelve `design_public_get` para un diseño propio publicado (se pisa lo que haga falta). */
export function rpcDesign(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: CODE,
    name: "Certificado · Ana Pérez",
    format: "carta_h",
    kind: "design",
    status: "ready",
    published: true,
    allow_download: true,
    allow_indexing: false,
    published_at: "2026-11-07T12:00:00Z",
    issued_at: "2026-11-07T12:00:00Z",
    verify: false,
    doc_type: null,
    doc_type_label: null,
    void_reason: null,
    voided_at: null,
    page_count: 1,
    rendered: true,
    rendered_version: "3-1",
    business_name: "Academia Ejemplo",
    business_timezone: "America/Argentina/Buenos_Aires",
    doc: null,
    ...overrides,
  };
}

/** Lo que devuelve para una generación con verificación. */
export function rpcGeneration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return rpcDesign({ kind: "generation", published: false, verify: true, doc_type: "certificado", ...overrides });
}

export const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));

export interface PublicDb {
  db: MemoryDb;
  /** Lo que `design_public_get` va a devolver (se puede cambiar). */
  current: { value: unknown };
  /** Cuántas veces se contó el tope. */
  limitHits: { count: number };
}

/** Un `MemoryDb` con el diseño publicado, su negocio y su juego de archivos (una página PNG y un PDF). */
export function publicDb(opts: { rpc?: unknown; pages?: number; renders?: Record<string, unknown> | null; workspace?: Record<string, unknown> } = {}): PublicDb {
  const pages = opts.pages ?? 1;
  const folder = `${WS}/${DESIGN}/3-1`;
  const pagePaths = Array.from({ length: pages }, (_, i) => `${folder}/page-${String(i + 1).padStart(2, "0")}.png`);
  const renders = opts.renders === undefined ? { version: "3-1", pdf_path: `${folder}/document.pdf`, pages: pagePaths, rendered_at: "2026-11-07T12:00:00Z" } : opts.renders;
  const db = new MemoryDb({
    designs: [{ id: DESIGN, workspace_id: WS, code: CODE, renders: renders ?? {} }],
    workspaces: [{ id: WS, brand_name: "Academia Ejemplo", brand_logo_path: null, brand_color: "#1d4ed8", scheduling_public_base_url: null, design_settings: {}, ...opts.workspace }],
  });
  if (renders) {
    for (const p of pagePaths) db.put("design-renders", p, PNG, "image/png");
    db.put("design-renders", `${folder}/document.pdf`, new Uint8Array([37, 80, 68, 70]), "application/pdf");
  }
  const current = { value: opts.rpc === undefined ? rpcDesign({ page_count: pages }) : opts.rpc };
  const limitHits = { count: 0 };
  db.rpcs.design_public_get = () => current.value;
  db.rpcs.bump_rate_limit = () => ++limitHits.count;
  return { db, current, limitHits };
}
