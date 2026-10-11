import { describe, it, expect } from "vitest";
import { renderSuccess, validateSuccess, escapeHtml } from "./success";

const ctx = {
  formName: "Aplicación",
  answers: { nombre: "<b>Ana</b>", plan: "Pro" },
  submissionId: "sub-1",
  attribution: { utm_source: "meta", utm_campaign: "oct", fbclid: "no-va" },
};

describe("validateSuccess", () => {
  it("redirect con una URL que no es http(s) falla", () => {
    expect(validateSuccess({ mode: "redirect", url: "javascript:alert(1)", passParams: false }).ok).toBe(false);
    expect(validateSuccess({ mode: "redirect", url: "ftp://x.com", passParams: false }).ok).toBe(false);
    expect(validateSuccess({ mode: "redirect", url: "no es url", passParams: false }).ok).toBe(false);
  });

  it("acepta mensaje y redirect válidos", () => {
    expect(validateSuccess({ mode: "message", title: "Gracias", body: "Listo" }).ok).toBe(true);
    expect(validateSuccess({ mode: "redirect", url: "https://x.com/gracias", passParams: true }).ok).toBe(true);
  });
});

describe("renderSuccess", () => {
  it("escapa el HTML de las variables", () => {
    const r = renderSuccess({ mode: "message", body: "Gracias {{answer.nombre}}" }, ctx);
    expect(r.body).toBe("Gracias &lt;b&gt;Ana&lt;/b&gt;");
  });

  it("con escape false deja el texto tal cual (React lo escapa al pintar)", () => {
    const r = renderSuccess({ mode: "message", body: "Gracias {{answer.nombre}}" }, ctx, { escape: false });
    expect(r.body).toBe("Gracias <b>Ana</b>");
  });

  it("una variable que no resuelve queda vacía, no cruda", () => {
    const r = renderSuccess({ mode: "message", title: "Hola {{answer.apellido}}!", body: "{{form.name}}" }, ctx);
    expect(r.title).toBe("Hola !");
    expect(r.body).toBe("Aplicación");
  });

  it("passParams suma submission_id y los UTM, y NO las respuestas ni los ids de clic", () => {
    const r = renderSuccess({ mode: "redirect", url: "https://x.com/gracias?a=1", passParams: true }, ctx);
    const url = new URL(r.url!);
    expect(url.searchParams.get("submission_id")).toBe("sub-1");
    expect(url.searchParams.get("utm_source")).toBe("meta");
    expect(url.searchParams.get("a")).toBe("1");
    expect(url.searchParams.has("fbclid")).toBe(false);
    expect(r.url).not.toContain("Ana");
  });

  it("sin passParams la URL queda como está", () => {
    const r = renderSuccess({ mode: "redirect", url: "https://x.com/gracias", passParams: false }, ctx);
    expect(r.url).toBe("https://x.com/gracias");
  });

  it("el botón resuelve variables en la URL (codificadas) y descarta lo que no es http(s)", () => {
    const ok = renderSuccess(
      { mode: "message", button: { label: "Ver plan", url: "https://x.com/p?plan={{answer.plan}}" } },
      ctx,
    );
    expect(ok.button).toEqual({ label: "Ver plan", url: "https://x.com/p?plan=Pro" });
    const bad = renderSuccess({ mode: "message", button: { label: "x", url: "javascript:alert(1)" } }, ctx);
    expect(bad.button).toBeUndefined();
  });

  it("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
