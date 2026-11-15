import { describe, it, expect } from "vitest";
import { teamInviteEmail, teamNotificationEmail, brandedEmailHtml, emailTheme } from "./templates";
import { BRAND_TEXT_DARK, BRAND_TEXT_LIGHT, contrastRatio, type Brand } from "@/lib/brand";

const brand = (over: Partial<Brand> = {}): Brand => ({
  name: "Negocio Demo",
  logoUrl: null,
  colorHex: "#1d4ed8",
  initial: "N",
  ...over,
});

const invite = (b: Brand) =>
  teamInviteEmail({
    workspaceName: "Equipo Demo",
    inviteUrl: "https://app.ejemplo.com/invite/abc",
    roleLabel: "Admin",
    inviterName: "Ana",
    brand: b,
  });

describe("teamInviteEmail", () => {
  it("lleva el color del negocio en la franja y el boton, con texto claro sobre un color oscuro", () => {
    const { html, subject } = invite(brand());
    expect(subject).toBe("Te invitaron a Equipo Demo");
    expect(html).toContain('bgcolor="#1d4ed8"');
    expect(html).toContain(`color:${BRAND_TEXT_LIGHT};text-decoration:none`);
    expect(html).toContain("Aceptar la invitación");
    expect(html).toContain("<strong>Ana</strong> te invitó");
    expect(html).toContain("Admin");
  });

  it("con un color claro, el texto del boton va oscuro y el link se oscurece hasta leerse", () => {
    const { html } = invite(brand({ colorHex: "#fde047" }));
    expect(html).toContain(`color:${BRAND_TEXT_DARK};text-decoration:none`);
    const theme = emailTheme(brand({ colorHex: "#fde047" }));
    expect(contrastRatio(theme.ink, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(html).toContain(`color:${theme.ink};word-break:break-all`);
  });

  it("un color casi blanco le pone un borde al boton para que se vea", () => {
    expect(emailTheme(brand({ colorHex: "#fefce8" })).buttonBorder).not.toBeNull();
    expect(emailTheme(brand({ colorHex: "#1d4ed8" })).buttonBorder).toBeNull();
  });

  it("con logo muestra la imagen con el nombre como texto alternativo", () => {
    const { html } = invite(brand({ logoUrl: "https://x.supabase.co/storage/v1/object/public/brand-assets/ws/logo.png" }));
    expect(html).toContain('<img src="https://x.supabase.co/storage/v1/object/public/brand-assets/ws/logo.png" alt="Negocio Demo"');
  });

  it("sin logo muestra la inicial en un cuadrado del color", () => {
    const { html } = invite(brand());
    expect(html).not.toContain("<img");
    expect(html).toMatch(/bgcolor="#1d4ed8" style="width:56px[^"]*">N<\/td>/);
  });

  it("sin color de marca usa un gris casi negro, con texto claro", () => {
    const { html } = invite(brand({ colorHex: null }));
    expect(html).toContain('bgcolor="#111827"');
    expect(html).toContain(`color:${BRAND_TEXT_LIGHT};text-decoration:none`);
  });

  it("escapa los nombres", () => {
    const { html } = teamInviteEmail({
      workspaceName: "<b>x</b>",
      inviteUrl: "https://a.com/?a=1&b=2",
      roleLabel: "Admin",
      inviterName: '"<script>"',
      brand: brand({ name: "<i>Marca</i>" }),
    });
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<i>Marca</i>");
    expect(html).toContain("https://a.com/?a=1&amp;b=2");
  });

  it("sin quien invita, no lo nombra", () => {
    const { html } = teamInviteEmail({ workspaceName: "W", inviteUrl: "https://a.com", roleLabel: "Member", brand: brand() });
    expect(html).toContain("Te invitaron a sumarte al equipo de <strong>W</strong>");
  });
});

describe("teamNotificationEmail", () => {
  it("lleva la marca, el boton y el link para cambiar los avisos", () => {
    const { html, subject } = teamNotificationEmail({
      title: "Nueva tarea",
      body: "Te asignaron algo",
      url: "https://a.com/t/1",
      settingsUrl: "https://a.com/dashboard/cuenta?tab=notificaciones",
      businessName: "Demo",
      brand: brand({ colorHex: "#a5f3fc" }),
    });
    expect(subject).toBe("Demo: Nueva tarea");
    expect(html).toContain("Ver en el sistema");
    expect(html).toContain(`color:${BRAND_TEXT_DARK};text-decoration:none`);
    expect(html).toContain("Cambiar qué avisos recibo");
  });

  it("sin link no dibuja boton", () => {
    const { html } = teamNotificationEmail({ title: "Hola", url: null, settingsUrl: "https://a.com", brand: brand() });
    expect(html).not.toContain("Ver en el sistema");
  });
});

describe("brandedEmailHtml", () => {
  it("firma con el nombre del negocio", () => {
    expect(brandedEmailHtml({ brand: brand(), body: "<p>x</p>" })).toContain("Enviado por Negocio Demo");
  });
});

describe("emails del estudiante (F128)", () => {
  it("el resumen semanal lleva las secciones escapadas, el botón al portal y cómo apagarlo", async () => {
    const { portalDigestEmail } = await import("./templates");
    const e = portalDigestEmail({ studentName: "Ana <b>Pérez", programName: "Prog & Co", sections: [{ key: "done", title: "Lo que hiciste", text: "Completaste 2 pasos." }, { key: "referrals", title: "Referidos", text: "Compartí tu link." }], portalUrl: "https://portal.example.com/" });
    expect(e.subject).toBe("Tu semana en Prog & Co");
    expect(e.html).toContain("Ana");
    expect(e.html).not.toContain("<b>Pérez");
    expect(e.html).toContain("Prog &amp; Co");
    expect(e.html.indexOf("Lo que hiciste")).toBeLessThan(e.html.indexOf("Referidos"));
    expect(e.html).toContain("Entrar al portal");
    expect(e.html).toContain("Lo podés apagar");
  });
  it("«Lo que vence hoy»: asunto en singular y en plural, con la hora", async () => {
    const { portalDueTodayEmail } = await import("./templates");
    expect(portalDueTodayEmail({ studentName: null, programName: "P", items: [{ name: "Reporte diario", time: "23:59" }] }).subject).toBe("Hoy vence «Reporte diario»");
    const two = portalDueTodayEmail({ studentName: "Leo", programName: "P", items: [{ name: "A" }, { name: "B" }] });
    expect(two.subject).toBe("Hoy vencen 2 cosas en P");
    expect(portalDueTodayEmail({ studentName: null, programName: "P", items: [{ name: "X", time: "18:00" }] }).html).toContain("hasta las 18:00");
  });
});
