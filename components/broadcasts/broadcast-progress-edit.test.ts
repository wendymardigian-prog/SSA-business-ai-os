/**
 * «Editar», «Editar mensaje» y «Eliminar» en el detalle de un broadcast, dibujados de verdad: cada botón aparece solo
 * cuando la regla lo permite (`lib/broadcasts/list.ts`). La que decide de verdad es la base (00347, 00355).
 */

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BroadcastStatus } from "@/lib/types/database";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/broadcasts", () => ({
  cancelBroadcastAction: vi.fn(),
  deleteBroadcastAction: vi.fn(),
  pauseBroadcastAction: vi.fn(),
  reopenBroadcastAction: vi.fn(),
  resumeBroadcastAction: vi.fn(),
  resumeLaneAction: vi.fn(),
  saveBroadcastMessageAction: vi.fn(),
}));

import { BroadcastProgress } from "./broadcast-progress";

function render(status: BroadcastStatus, sent: number) {
  return renderToStaticMarkup(
    createElement(BroadcastProgress, {
      broadcast: {
        id: "b-1",
        name: "Clase",
        status,
        scheduledFor: null,
        startedAt: null,
        completedAt: null,
        previewText: "Hola",
        variants: ["Hola"],
        emailSubject: "",
        emailPreheader: "",
        channelKind: "whatsapp",
      },
      variableList: ["contact.first_name"],
      channel: { id: "ch", label: "WhatsApp" },
      policy: null,
      lane: null,
      counts: { pending: 10 - sent, sending: 0, sent, failed: 0, skipped: 0, cancelled: 0 },
      recipients: [],
      filter: "",
      page: 1,
      pageCount: 1,
      timeZone: "America/Costa_Rica",
      businessTimeZone: "America/Costa_Rica",
    }),
  );
}

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());

describe("BroadcastProgress: editar", () => {
  it("programado sin envíos: Editar, Editar mensaje y Eliminar", () => {
    const b = buttons(render("scheduled", 0));
    expect(b).toEqual(expect.arrayContaining(["Editar", "Editar mensaje", "Eliminar"]));
  });

  it("pausado con envíos: solo Editar mensaje (ni Editar ni Eliminar)", () => {
    const b = buttons(render("paused", 3));
    expect(b).toContain("Editar mensaje");
    expect(b).not.toContain("Editar");
    expect(b).not.toContain("Eliminar");
  });

  it("enviándose: ninguno de los tres (primero se pausa)", () => {
    const b = buttons(render("sending", 0));
    expect(b).not.toContain("Editar");
    expect(b).not.toContain("Editar mensaje");
    expect(b).not.toContain("Eliminar");
  });

  it("terminado: ni Editar ni Editar mensaje", () => {
    const b = buttons(render("completed", 10));
    expect(b).not.toContain("Editar");
    expect(b).not.toContain("Editar mensaje");
  });
});
