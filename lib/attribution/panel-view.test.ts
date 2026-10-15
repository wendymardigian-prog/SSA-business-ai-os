import { describe, expect, it } from "vitest";
import {
  attributionPanelView,
  flowHasNoContact,
  splitCodeSpans,
  newNodeAttribution,
  nextAttribution,
  readStoredAttribution,
  type AttributionPanelInput,
} from "./panel-view";

const FLOW_ID = "9f3a1c7e-1111-4222-8333-444455556666";
const off = { append: false, trackClicks: true };
const base: AttributionPanelInput = {
  attribution: undefined,
  defaults: off,
  flowId: FLOW_ID,
  flowName: "Info Reel",
  triggerType: "keyword",
};

describe("readStoredAttribution", () => {
  it("lee solo lo que trae append booleano", () => {
    expect(readStoredAttribution({ append: true, trackClicks: true })).toEqual({ append: true, trackClicks: true });
    expect(readStoredAttribution({ append: false })).toEqual({ append: false, trackClicks: false });
    expect(readStoredAttribution(undefined)).toBeNull();
    expect(readStoredAttribution([])).toBeNull();
    expect(readStoredAttribution({ append: "yes" })).toBeNull();
    expect(readStoredAttribution("x")).toBeNull();
  });
});

describe("nextAttribution", () => {
  it("al prender con la clave ausente guarda el default de «Registrar el clic»", () => {
    expect(nextAttribution(undefined, { append: true }, { append: false, trackClicks: true })).toEqual({ append: true, trackClicks: true });
    expect(nextAttribution(undefined, { append: true }, { append: false, trackClicks: false })).toEqual({ append: true, trackClicks: false });
  });

  it("apagar conserva «Registrar el clic» y prender de nuevo lo recupera", () => {
    const apagado = nextAttribution({ append: true, trackClicks: false }, { append: false }, off);
    expect(apagado).toEqual({ append: false, trackClicks: false });
    expect(nextAttribution(apagado, { append: true }, off)).toEqual({ append: true, trackClicks: false });
  });

  it("cambiar solo «Registrar el clic» deja el primero encendido", () => {
    expect(nextAttribution({ append: true, trackClicks: true }, { trackClicks: false }, off)).toEqual({ append: true, trackClicks: false });
  });
});

describe("newNodeAttribution", () => {
  it("siembra solo si el negocio lo tiene encendido por defecto", () => {
    expect(newNodeAttribution({ append: true, trackClicks: false })).toEqual({ append: true, trackClicks: false });
    expect(newNodeAttribution({ append: false, trackClicks: true })).toBeUndefined();
  });
});

describe("attributionPanelView", () => {
  it("un nodo sin la clave está apagado, cerrado y no ofrece «Registrar el clic»", () => {
    const view = attributionPanelView(base);
    expect(view.hasKey).toBe(false);
    expect(view.append).toBe(false);
    expect(view.startOpen).toBe(false);
    expect(view.showTrackClicks).toBe(false);
    expect(view.trackNote).toBeNull();
    expect(view.businessDefaultHint).toBeNull();
  });

  it("sin la clave pero con el negocio encendido por defecto: sigue apagado y lo avisa", () => {
    const view = attributionPanelView({ ...base, defaults: { append: true, trackClicks: true } });
    expect(view.append).toBe(false);
    expect(view.businessDefaultHint).toMatch(/por defecto/);
  });

  it("encendido arranca abierto, ofrece «Registrar el clic» y arma los cuatro parámetros", () => {
    const view = attributionPanelView({ ...base, attribution: { append: true, trackClicks: false } });
    expect(view.append).toBe(true);
    expect(view.startOpen).toBe(true);
    expect(view.showTrackClicks).toBe(true);
    expect(view.params.map((p) => p.key)).toEqual(["utm_source", "utm_medium", "utm_campaign", "utm_content"]);
    expect(view.trackNote).toBeNull();
  });

  it("sin pieza: utm_content es el código del flujo y lo explica", () => {
    const view = attributionPanelView({ ...base, attribution: { append: true, trackClicks: true } });
    expect(view.params.find((p) => p.key === "utm_content")?.value).toBe("f-9f3a1c7e");
    expect(view.contentLine).toContain("`f-9f3a1c7e`");
    expect(view.contentLine).toContain("no arranca desde una pieza");
    expect(view.exampleLead).toBe("Con un mensaje");
    expect(view.exampleAfter).toBe(
      "https://tu-sitio.com/programa?utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=f-9f3a1c7e",
    );
  });

  it("un comentario habla de una pieza y de su código", () => {
    const view = attributionPanelView({ ...base, triggerType: "comment_keyword", attribution: { append: true, trackClicks: true } });
    expect(view.exampleLead).toBe("Con un comentario en una pieza");
    expect(view.params.find((p) => p.key === "utm_content")?.value).toBe("c8k2f");
    expect(view.contentLine).toContain("código de la pieza");
    expect(view.contentLine).not.toContain("no arranca desde una pieza");
  });

  it("una respuesta a historia también cuenta como contenido; una palabra clave común, no", () => {
    const story = attributionPanelView({ ...base, storyReply: true, attribution: { append: true, trackClicks: true } });
    expect(story.exampleLead).toBe("Con una respuesta a tu historia en una pieza");
    const plain = attributionPanelView({ ...base, storyReply: false, attribution: { append: true, trackClicks: true } });
    expect(plain.exampleLead).toBe("Con un mensaje");
  });

  it("sin nombre dice «tu flujo»; con plataforma conocida no aclara que es de muestra", () => {
    const unnamed = attributionPanelView({ ...base, flowName: "  ", attribution: { append: true, trackClicks: true } });
    expect(unnamed.params.find((p) => p.key === "utm_campaign")?.value).toBe("tu-flujo");
    expect(unnamed.sourceNote).toMatch(/instagram, whatsapp/);
    const known = attributionPanelView({ ...base, platform: "whatsapp", attribution: { append: true, trackClicks: true } });
    expect(known.params.find((p) => p.key === "utm_source")?.value).toBe("whatsapp");
    expect(known.sourceNote).toBeNull();
  });

  it("con «Registrar el clic» explica el rodeo; sin contacto avisa que no hay seguimiento", () => {
    const withContact = attributionPanelView({ ...base, attribution: { append: true, trackClicks: true } });
    expect(withContact.trackNote).toBe(
      "El link que recibe la persona pasa primero por tu sistema, que anota el clic y la manda al destino.",
    );
    expect(withContact.noContactNote).toBeNull();

    const webhook = attributionPanelView({ ...base, triggerType: "webhook_received", attribution: { append: true, trackClicks: true } });
    expect(webhook.noContactNote).toMatch(/sin seguimiento/);

    const webhookNoTrack = attributionPanelView({ ...base, triggerType: "webhook_received", attribution: { append: true, trackClicks: false } });
    expect(webhookNoTrack.noContactNote).toBeNull();
  });
});

describe("flowHasNoContact", () => {
  it("webhook y reporte de fin de día no tienen contacto; un mensaje sí", () => {
    expect(flowHasNoContact("webhook_received")).toBe(true);
    expect(flowHasNoContact("eod_submitted")).toBe(true);
    expect(flowHasNoContact("keyword")).toBe(false);
    expect(flowHasNoContact(undefined)).toBe(false);
  });
});

describe("splitCodeSpans", () => {
  it("separa los códigos entre acentos graves", () => {
    expect(splitCodeSpans("utm_content = el código (`f-1234abcd`) porque sí.")).toEqual([
      { text: "utm_content = el código (", code: false },
      { text: "f-1234abcd", code: true },
      { text: ") porque sí.", code: false },
    ]);
    expect(splitCodeSpans("sin códigos")).toEqual([{ text: "sin códigos", code: false }]);
    expect(splitCodeSpans("")).toEqual([]);
  });
});
