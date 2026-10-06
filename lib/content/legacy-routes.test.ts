/**
 * F99: las rutas viejas de la pieza redirigen al drawer, y una pieza que no
 * existe sigue dando el mismo 404.
 */

import { describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { legacyPieceHref } from "./legacy-routes";

const WS = "ws-1";
const ID = "425ac42a-2c7b-42ec-b047-5af199b64cc6";

let db: MemoryDb;

const seed = () => {
  db = memoryDb({
    content_posts: [
      { id: ID, workspace_id: WS, title: "Una pieza", archived_at: null },
      { id: "archivada", workspace_id: WS, title: "Vieja", archived_at: "2026-10-01T00:00:00Z" },
      { id: "ajena", workspace_id: "otro-ws", title: "Ajena" },
    ],
  });
};

describe("legacyPieceHref (F99)", () => {
  it("una pieza que existe va al tablero con el drawer abierto en ella", async () => {
    seed();

    expect(await legacyPieceHref(db.client as never, WS, ID)).toBe(`/dashboard/content?piece=${ID}`);
  });

  it("una pieza archivada tambien: hay links viejos a piezas que ya salieron del tablero", async () => {
    seed();

    expect(await legacyPieceHref(db.client as never, WS, "archivada")).toContain("piece=archivada");
  });

  it("CRITERIO: una pieza que no existe, o de otro negocio, es null (y la ruta da 404)", async () => {
    seed();

    expect(await legacyPieceHref(db.client as never, WS, "no-existe")).toBeNull();
    expect(await legacyPieceHref(db.client as never, WS, "ajena")).toBeNull();
  });
});

describe("las rutas viejas, de punta a punta (F99)", () => {
  vi.mock("next/navigation", () => ({
    redirect: (url: string) => {
      throw new Error(`REDIRECT:${url}`);
    },
    notFound: () => {
      throw new Error("NOT_FOUND");
    },
  }));
  vi.mock("@/lib/auth/guards", () => ({
    getPermissionContext: async () => ({ workspace: { id: WS }, supabase: db.client }),
  }));

  it("el detalle viejo redirige", async () => {
    seed();
    const { default: Page } = await import("@/app/(dashboard)/dashboard/content/[postId]/page");

    await expect(Page({ params: Promise.resolve({ postId: ID }) })).rejects.toThrow(`REDIRECT:/dashboard/content?piece=${ID}`);
  });

  it("el editor viejo redirige", async () => {
    seed();
    const { default: Page } = await import("@/app/(dashboard)/dashboard/content/[postId]/edit/page");

    await expect(Page({ params: Promise.resolve({ postId: ID }) })).rejects.toThrow(`REDIRECT:/dashboard/content?piece=${ID}`);
  });

  it("una pieza que no existe da el mismo 404 de hoy, en las dos", async () => {
    seed();
    const detail = await import("@/app/(dashboard)/dashboard/content/[postId]/page");
    const edit = await import("@/app/(dashboard)/dashboard/content/[postId]/edit/page");

    await expect(detail.default({ params: Promise.resolve({ postId: "no-existe" }) })).rejects.toThrow("NOT_FOUND");
    await expect(edit.default({ params: Promise.resolve({ postId: "no-existe" }) })).rejects.toThrow("NOT_FOUND");
  });
});
