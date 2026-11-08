/**
 * El destello de la tarjeta del tablero (DS8, F65): una pieza con un diseño del Diseñador IA lo muestra; las demás se ven
 * exactamente como siempre.
 */

import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BoardPost } from "@/lib/content/board";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/content", () => ({
  movePostToColumn: async () => ({ ok: true }),
  createPost: async () => ({ ok: true, data: { id: "p" } }),
  createIdea: async () => ({ ok: true }),
  approveIdea: async () => ({ ok: true }),
  discardIdea: async () => ({ ok: true }),
  updateIdea: async () => ({ ok: true }),
}));

const { ContentKanban } = await import("./kanban");

const post = (over: Partial<BoardPost> = {}): BoardPost => ({
  kind: "post",
  id: "p1",
  title: "Una pieza",
  format: null,
  status: "draft",
  createdBy: "u1",
  position: 10,
  networks: [{ platform: "instagram", at: null, status: null }],
  hasCopy: true,
  hasCaption: true,
  copyFromAi: false,
  copyStatus: "idle",
  pillar: null,
  offer: null,
  funnelStage: null,
  attributedContacts: null,
  createdAt: "2026-10-01T15:00:00Z",
  updatedAt: "2026-10-02T15:00:00Z",
  authorName: "Ana Pérez",
  authorship: "Ana Pérez · creada el 1 oct",
  assignee: null,
  ...over,
});

const render = (posts: BoardPost[]) =>
  renderToStaticMarkup(
    createElement(ContentKanban, {
      ideas: [],
      posts,
      perms: { create: true, approve: false, publish: false, ai: false },
      currentUserId: "u1",
      platforms: ["instagram"],
      taxonomy: { pillars: [], offers: [], canCreate: false },
      timeZone: "America/Argentina/Buenos_Aires",
    }),
  );

describe("el destello de una pieza con diseño en el tablero (F65)", () => {
  it("una pieza con diseño muestra un destello chico con su explicación", () => {
    const html = render([post({ hasDesign: true })]);

    expect(html).toContain('data-testid="has-design"');
    expect(html).toContain('aria-label="Tiene un diseño del Diseñador IA"');
  });

  it("una pieza sin diseño no lo muestra, y se ve igual que siempre", () => {
    const sin = render([post()]);
    const falso = render([post({ hasDesign: false })]);

    expect(sin).not.toContain("has-design");
    expect(sin).toBe(falso);
    expect(sin).toContain("Una pieza");
  });

  it("solo la pieza que lo tiene lleva el destello", () => {
    const html = render([post({ id: "a", title: "Con diseño", hasDesign: true }), post({ id: "b", title: "Sin diseño" })]);

    expect((html.match(/has-design/g) ?? []).length).toBe(1);
  });
});
