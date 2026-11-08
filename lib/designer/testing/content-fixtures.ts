/**
 * Datos de prueba de DS8 (Contenido): un negocio con una pieza y un diseño vinculado, en la base en memoria. Solo para
 * tests: nunca habla con nadie.
 */

import { emptyDoc, newId, type DesignDoc } from "../doc/schema";
import type { FormatKey } from "../formats";
import { MemoryDb, type Row } from "./memory-db";

export const WS = "11111111-2222-3333-4444-555555555555";
export const USER = "99999999-2222-3333-4444-555555555555";
export const DESIGN = "aaaaaaaa-2222-3333-4444-555555555555";
export const POST = "bbbbbbbb-2222-3333-4444-555555555555";
export const NOW = new Date("2026-11-08T12:00:00Z");

/** Un diseño de `pages` páginas con el fondo de un color. */
export function docWithPages(format: FormatKey, pages: number): DesignDoc {
  const doc = emptyDoc(format);
  for (let i = 1; i < pages; i++) doc.pages.push({ id: newId("pg"), background: { type: "color", color: "#ffffff" }, elements: [] });
  return doc;
}

export interface WorldOptions {
  format?: FormatKey;
  pages?: number;
  rev?: number;
  postStatus?: string;
  networks?: Row[];
  media?: Row[];
  publications?: Row[];
  accounts?: Row[];
  design?: Row;
  postUpdatedAt?: string;
}

/** Una pieza de Instagram con un carrusel, vinculada a un diseño. */
export function world(opts: WorldOptions = {}): MemoryDb {
  const format = opts.format ?? "v45";
  return new MemoryDb({
    designs: [
      {
        id: DESIGN,
        workspace_id: WS,
        name: "Carrusel de prueba",
        format,
        doc: docWithPages(format, opts.pages ?? 3),
        rev: opts.rev ?? 4,
        content_post_id: POST,
        content_network: "instagram",
        archived_at: null,
        template_id: null,
        ...opts.design,
      },
    ],
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        title: "Una pieza",
        caption: "Un caption",
        status: opts.postStatus ?? "draft",
        updated_at: opts.postUpdatedAt ?? "2026-11-08T10:00:00Z",
        media: opts.media ?? [],
        networks: opts.networks ?? [{ platform: "instagram", planned_at: null, format: "carousel", files: [], options: {} }],
      },
    ],
    social_posts: opts.publications ?? [],
    social_accounts: opts.accounts ?? [{ workspace_id: WS, platform: "instagram", is_active: true, default_publisher: "zernio" }],
    workspaces: [{ id: WS, design_settings: {} }],
    scheduled_jobs: [],
  });
}

export const post = (db: MemoryDb): Row => db.rows("content_posts")[0];
export const networksOf = (db: MemoryDb): Array<Record<string, unknown>> => post(db).networks as Array<Record<string, unknown>>;
export const mediaOf = (db: MemoryDb): Array<Record<string, unknown>> => post(db).media as Array<Record<string, unknown>>;
