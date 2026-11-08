/**
 * La encuesta de un grupo ofrece «Ver quién votó» (antes los nombres solo salían pasando el mouse).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/dashboard-chrome", () => ({ useViewerTimezone: () => "America/Argentina/Buenos_Aires" }));
vi.mock("./create-group-automation-dialog", () => ({ CreateGroupAutomationDialog: () => null }));
vi.mock("./poll-answer-tags-dialog", () => ({ PollAnswerTagsDialog: () => null }));

import { GroupMessageBubble } from "./group-message-bubble";
import type { ThreadMessage } from "@/lib/whatsapp-groups/thread";

const poll = (options: NonNullable<ThreadMessage["poll"]>["options"], totalVoters: number): ThreadMessage => ({
  id: "m1",
  outbound: true,
  senderLabel: null,
  contactId: null,
  text: null,
  attachments: [],
  poll: { name: "¿Venís?", multiple: false, options, totalVoters },
  reactions: [],
  failed: false,
  sendError: null,
  fromFlow: false,
  createdAt: "2026-11-08T12:00:00.000Z",
});

const render = (message: ThreadMessage, canCreateAutomation = false) => renderToStaticMarkup(createElement(GroupMessageBubble, { message, canCreateAutomation }));

describe("GroupMessageBubble: quién votó", () => {
  it("con votos ofrece «Ver quién votó» (cerrado al principio)", () => {
    const html = render(poll([{ name: "Sí", count: 1, voters: [{ name: "Ana", contactId: "c1" }] }, { name: "No", count: 0, voters: [] }], 1));
    expect(html).toContain("Ver quién votó");
    expect(html).toContain('aria-expanded="false"');
    // Cerrado no muestra la lista, pero el cartelito al pasar el mouse sigue.
    expect(html).not.toContain("/dashboard/contacts/c1");
    expect(html).toContain('title="Ana"');
  });

  it("sin votos no lo ofrece", () => {
    expect(render(poll([{ name: "Sí", count: 0, voters: [] }], 0))).not.toContain("Ver quién votó");
  });
});

describe("GroupMessageBubble: etiquetar según la respuesta", () => {
  it("lo ofrece solo a quien puede crear automatizaciones", () => {
    const message = poll([{ name: "Sí", count: 0, voters: [] }], 0);
    expect(render(message, true)).toContain("Etiquetar según la respuesta");
    expect(render(message, false)).not.toContain("Etiquetar según la respuesta");
  });
});

