import { describe, it, expect } from "vitest";
import { computeEodMetrics, isValidMetricKey, metricKeysOf, metricLabel } from "./metrics";
import { setterTemplate } from "./templates";

const def = setterTemplate();
const channels = def.channels!;

describe("computeEodMetrics", () => {
  it("Instagram 5 + WhatsApp 7 links = 12 en total, y cada canal el suyo", () => {
    const metrics = computeEodMetrics({
      generalFields: def.fields,
      generalAnswers: { horas_trabajadas: 8, rendimiento: 7 },
      channels,
      channelAnswers: { instagram: { links_enviados: 5 }, whatsapp: { links_enviados: 7 } },
      selectedKeys: ["instagram", "whatsapp"],
    });
    expect(metrics.total.links_enviados).toBe(12);
    expect(metrics.instagram.links_enviados).toBe(5);
    expect(metrics.whatsapp.links_enviados).toBe(7);
    expect(metrics.total.horas_trabajadas).toBe(8);
    expect(metrics.general).toEqual({ horas_trabajadas: 8, rendimiento: 7 });
  });

  it("un canal NO elegido no suma aunque tenga valores", () => {
    const metrics = computeEodMetrics({
      generalFields: [],
      generalAnswers: {},
      channels,
      channelAnswers: { instagram: { links_enviados: 5 }, linkedin: { links_enviados: 100 } },
      selectedKeys: ["instagram"],
    });
    expect(metrics.total.links_enviados).toBe(5);
    expect(metrics.linkedin).toBeUndefined();
  });

  it("un valor vacío o de texto no suma: nunca se inventa un cero", () => {
    const metrics = computeEodMetrics({
      generalFields: [],
      generalAnswers: {},
      channels,
      channelAnswers: { instagram: { links_enviados: "" } },
      selectedKeys: ["instagram"],
    });
    expect(metrics.total).toEqual({});
  });

  it("catálogo, Otra y etiquetas", () => {
    expect(isValidMetricKey("links_enviados")).toBe(true);
    expect(isValidMetricKey("mi_metrica")).toBe(true);
    expect(isValidMetricKey("x")).toBe(false);
    expect(metricLabel("conv_inbound")).toBe("Conversaciones nuevas inbound");
    expect(metricLabel("mi_metrica")).toBe("mi_metrica");
    expect(metricKeysOf(def.fields, channels)).toEqual(["horas_trabajadas", "rendimiento", "conv_inbound", "conv_outbound", "seguimientos", "respuestas", "links_enviados", "llamadas_agendadas"]);
  });
});
