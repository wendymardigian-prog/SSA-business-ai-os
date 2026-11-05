import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmailMessageBody } from "./email-message-body";

const html = (message: Record<string, unknown>) => renderToStaticMarkup(createElement(EmailMessageBody, { message }));

describe("el cuerpo de un email entrante", () => {
  it("muestra lo nuevo y deja la cita cerrada detrás de un botón", () => {
    const out = html({ text: "Gracias!", email_quoted_text: "> Hola\n> Chau" });
    expect(out).toContain("Gracias!");
    expect(out).toContain("Ver mensaje citado");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("Chau");
  });

  it("un mensaje viejo, guardado con la cita adentro, se separa al dibujarlo", () => {
    const out = html({ text: "Gracias!\n\nOn Wed Ana wrote:\n> Hola", email_quoted_text: null });
    expect(out).toContain("Ver mensaje citado");
    expect(out).not.toContain("&gt; Hola");
  });

  it("sin cita no hay botón", () => {
    expect(html({ text: "Hola" })).not.toContain("Ver mensaje citado");
  });
});
