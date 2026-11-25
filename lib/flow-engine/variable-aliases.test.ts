import { describe, expect, it } from "vitest";
import { aliasFor, EXACT_ALIASES, preferredName } from "./variable-aliases";

describe("aliasFor", () => {
  it("traduce los nombres exactos", () => {
    expect(aliasFor("message.text")).toBe("message");
    expect(aliasFor("comment.author_name")).toBe("commenter_name");
    expect(aliasFor("event.previous_level")).toBe("event_previous_level");
    expect(aliasFor("contact.fail_reason")).toBe("contact_fail_reason");
  });

  it("traduce los prefijos y conserva lo que sigue", () => {
    expect(aliasFor("form.answer.mejor_horario")).toBe("answer.mejor_horario");
    expect(aliasFor("form.answer_raw.fecha")).toBe("answer_raw.fecha");
    expect(aliasFor("booking.answer.presupuesto")).toBe("booking.answers.presupuesto");
    expect(aliasFor("message.origin.ad_id")).toBe("message_origin.ad_id");
  });

  it("lo que no es alias devuelve null", () => {
    expect(aliasFor("contact.first_name")).toBeNull();
    expect(aliasFor("form.name")).toBeNull();
    expect(aliasFor("form.answer.")).toBeNull();
  });
});

describe("preferredName", () => {
  it("es la vuelta de aliasFor", () => {
    for (const [alias, real] of Object.entries(EXACT_ALIASES)) expect(preferredName(real)).toBe(alias);
    expect(preferredName("answer.x")).toBe("form.answer.x");
    expect(preferredName("answer_raw.x")).toBe("form.answer_raw.x");
    expect(preferredName("booking.answers.x")).toBe("booking.answer.x");
    expect(preferredName("message_origin.ad_title")).toBe("message.origin.ad_title");
  });

  it("deja igual lo que ya sigue «grupo.campo»", () => {
    expect(preferredName("booking.start_invitee")).toBe("booking.start_invitee");
    expect(preferredName("contact.email")).toBe("contact.email");
  });
});
