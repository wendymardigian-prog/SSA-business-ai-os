/**
 * La URL de entrada en el toque (plano formularios-ui, F17 y F18). Lo que hace la base con ella
 * (`contact_touches.entry_url`, 00215) lo prueba `scripts/verify-forms.mjs` contra la base real.
 */
import { describe, expect, it, vi } from "vitest";
import { parseTouch, recordTouch } from "./touch";
import { formTouch } from "./touch-entry";

const META =
  "https://ejemplo.test/programa-x?utm_source=facebook&ad_name=Video+Noe&campaign_name=Programa+X&site_source_name=ig&ref=podcast&token=SECRETO";

describe("parseTouch con entryUrl", () => {
  const base = { source: "facebook", origin: "form" as const, dedupeKey: "form:1" };

  it("la manda como entry_url, saneada (sin el token) y con todos los demas parametros", () => {
    const parsed = parseTouch({ ...base, entryUrl: META });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.touch.entry_url).toBe("https://ejemplo.test/programa-x?utm_source=facebook&ad_name=Video+Noe&campaign_name=Programa+X&site_source_name=ig&ref=podcast");
      expect(JSON.stringify(parsed.touch)).not.toContain("SECRETO");
    }
  });

  it("una URL de mas de 500 caracteres NO hace fallar el toque (landing_page si lo haria)", () => {
    const long = `https://ejemplo.test/p?utm_source=facebook&relleno=${"z".repeat(1500)}`;
    const parsed = parseTouch({ ...base, entryUrl: long });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(String(parsed.touch.entry_url).length).toBeGreaterThan(1000);
  });

  it("una URL que no sirve se descarta y el toque se registra igual", () => {
    for (const bad of ["javascript:alert(1)", "no es una url", "", null, undefined]) {
      const parsed = parseTouch({ ...base, entryUrl: bad });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect("entry_url" in parsed.touch).toBe(false);
    }
  });

  it("sin entryUrl el toque queda como siempre (sin la clave)", () => {
    const parsed = parseTouch(base);
    expect(parsed.ok && "entry_url" in parsed.touch).toBe(false);
  });

  it("no la guarda en raw (raw sigue siendo una lista blanca)", () => {
    const parsed = parseTouch({ ...base, entryUrl: META, raw: { entry_url: META, page_url: "https://ejemplo.test/p" } });
    expect(parsed.ok && (parsed.touch.raw as Record<string, unknown>).entry_url).toBeUndefined();
  });
});

describe("formTouch pasa la URL de entrada", () => {
  const input = { submissionId: "s1", formId: "f1", formName: "Aplicacion" };

  it("entry_url de la atribucion va como entryUrl; landing_page sigue siendo la filtrada", () => {
    const touch = formTouch({
      ...input,
      attribution: { utm_source: "facebook", landing_page: "https://ejemplo.test/programa-x?utm_source=facebook", entry_url: META },
    });
    expect(touch.entryUrl).toBe(META);
    expect(touch.landingPage).toBe("https://ejemplo.test/programa-x?utm_source=facebook");
  });

  it("sin entry_url no hay entryUrl", () => {
    expect(formTouch({ ...input, attribution: { utm_source: "facebook" } }).entryUrl).toBeNull();
  });
});

describe("recordTouch con entryUrl", () => {
  it("manda entry_url a la base en p_touch y no loguea la URL si falla", async () => {
    const rpc = vi.fn(async () => ({ data: { inserted: true }, error: null }));
    const res = await recordTouch({ rpc } as never, {
      workspaceId: "ws",
      contactId: "c",
      touch: { source: "facebook", origin: "form", dedupeKey: "form:1", entryUrl: META },
    });
    expect(res.recorded).toBe(true);
    const sent = (rpc.mock.calls[0] as unknown as [string, { p_touch: Record<string, unknown> }])[1].p_touch;
    expect(String(sent.entry_url)).toContain("ad_name=Video+Noe");

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = vi.fn(async () => ({ data: null, error: { message: "algo fallo" } }));
    await recordTouch({ rpc: failing } as never, {
      workspaceId: "ws",
      contactId: "c",
      touch: { source: "facebook", origin: "form", dedupeKey: "form:2", entryUrl: META },
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("ejemplo.test");
    spy.mockRestore();
  });
});
