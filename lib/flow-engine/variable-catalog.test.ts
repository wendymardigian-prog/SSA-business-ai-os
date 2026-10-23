import { describe, expect, it } from "vitest";
import { interpolateVariables } from "./interpolate";
import { messageOriginVariables } from "@/lib/messages/origin-context";
import { CONTACT_VARIABLES, pickerVariables, seedContactVariables, staticTriggerVariables, WORKSPACE_VARIABLES } from "./variable-catalog";

/**
 * Paridad: lo que el selector ofrece se resuelve. Los contextos de ejemplo son los que arma cada emisor (el receptor
 * de mensajes, el de comentarios, el de email, el cron de inactividad y el de eventos del CRM).
 */
const seeded = (vars: Record<string, unknown>) =>
  seedContactVariables(vars, { display_name: "Ana Pérez", email: "ana@x.com", phone: "+5491100000000" }, { name: "Mi negocio" });

const EXAMPLES: Record<string, Record<string, unknown>> = {
  keyword: { message: "hola", message_origin: messageOriginVariables({ isStoryMention: true, adId: "ad-1", adTitle: "Promo" }) },
  comment_keyword: { message: "info", comment_id: "c1", comment_text: "info", commenter_name: "Ana", post_id: "p1", content: { title: "Reel", code: "R1" } },
  email_received: { message: "texto", email_subject: "Consulta" },
  inactivity: { inactivity_hours: "24" },
  new_contact: { event_type: "contact_created", event_source: "instagram" },
  crm_event: { event_type: "tag_added", event_tag_name: "vip", event_value: "x", event_role: "setter", event_reason: "pidio" },
};

describe("cada variable fija que ofrece el selector se resuelve", () => {
  for (const [type, vars] of Object.entries(EXAMPLES)) {
    it(type, () => {
      const ctx = seeded(vars);
      for (const v of [...staticTriggerVariables(type), ...CONTACT_VARIABLES, ...WORKSPACE_VARIABLES]) {
        const out = interpolateVariables(`{{${v}}}`, ctx as Record<string, unknown>);
        expect(out, `{{${v}}} en ${type}`).not.toBe(`{{${v}}}`);
      }
    });
  }
});

describe("pickerVariables", () => {
  it("un flujo de agenda no ofrece {{message}} y si las de la reunion que manda el servidor", () => {
    const vars = pickerVariables({ triggerType: "booking_created", schemaPaths: ["booking.start_invitee", "tag:", "variable:puntos"] });
    expect(vars).not.toContain("message");
    expect(vars).toEqual(expect.arrayContaining(["booking.start_invitee", "puntos", "contact.display_name", "workspace.name"]));
    expect(vars).not.toContain("tag:");
  });
  it("un webhook no ofrece el contacto hasta que un paso lo consigue", () => {
    expect(pickerVariables({ triggerType: "webhook_received" })).not.toContain("contact.display_name");
    expect(pickerVariables({ triggerType: "webhook_received", contactBefore: true })).toContain("contact.display_name");
  });
  it("suma lo de los pasos anteriores sin repetir", () => {
    expect(pickerVariables({ triggerType: "keyword", upstreamOutputs: ["ai_response", "ai_response"] }).filter((v) => v === "ai_response")).toHaveLength(1);
  });
});

describe("seedContactVariables", () => {
  it("no pisa lo que trajo el disparador (Ventas trae su contact.first_name)", () => {
    const out = seedContactVariables({ contact: { first_name: "Anita" } }, { display_name: "Ana Pérez" }, null) as { contact: Record<string, string> };
    expect(out.contact.first_name).toBe("Anita");
    expect(out.contact.display_name).toBe("Ana Pérez");
    expect(out.contact.name).toBe("Ana Pérez");
  });
});
