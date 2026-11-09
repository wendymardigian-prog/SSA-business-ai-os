// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { portalInviteEmail } from "./templates";

const base = { workspaceName: "Negocio Demo", inviteUrl: "https://portal.ejemplo.com/entrar/invitacion/abc", studentName: "Ana Pérez" };

describe("portalInviteEmail", () => {
  it("el texto viejo con {nombre} sale como siempre", () => {
    const out = portalInviteEmail({ ...base, subject: "Hola {nombre}, tu acceso", body: "Hola {nombre}, bienvenida.\n\nSegundo párrafo." });
    expect(out.subject).toBe("Hola Ana, tu acceso");
    expect(out.html).toContain(">Hola Ana, bienvenida.</p>");
    expect(out.html).toContain(">Segundo párrafo.</p>");
  });

  it("sin nombre, {nombre} no deja una coma colgando", () => {
    expect(portalInviteEmail({ ...base, studentName: null, subject: "Hola {nombre}, entrá" }).subject).toBe("Hola, entrá");
  });

  it("entiende las variables del catálogo en el asunto y en el texto", () => {
    const out = portalInviteEmail({ ...base, subject: "{{contact.first_name}}: tu acceso a {{workspace.name}}", body: "Hola {{contact.name}}" });
    expect(out.subject).toBe("Ana: tu acceso a Negocio Demo");
    expect(out.html).toContain("Hola Ana Pérez");
  });

  it("con formato: deja negrita y listas, pega los valores escapados y limpia lo peligroso", () => {
    const out = portalInviteEmail({
      ...base,
      studentName: '<img src=x onerror="alert(1)">',
      body: '<p>Hola <span data-variable="contact.first_name">{{contact.first_name}}</span>, <strong>bienvenida</strong></p><ul><li>Uno</li></ul><script>alert(1)</script>',
    });
    expect(out.html).toContain("<strong");
    expect(out.html).toContain("<li");
    expect(out.html).not.toContain("<script");
    expect(out.html).not.toContain("<img src=x");
    expect(out.html).toContain("&lt;img");
  });

  it("sin texto propio, el de siempre", () => {
    const out = portalInviteEmail(base);
    expect(out.subject).toBe("Tu acceso al portal de Negocio Demo");
    expect(out.html).toContain("Hola Ana, ya tenés tu acceso al portal de Negocio Demo.");
  });
});
