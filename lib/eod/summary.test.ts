import { describe, it, expect } from "vitest";
import { hasDataInUnselected, summaryLine } from "./summary";
import { setChannelSelected, setDraftValue, getDraftValue, emptyDraft } from "./draft";
import { setterTemplate } from "./templates";

const def = setterTemplate();

describe("la barra de resumen", () => {
  it("3 canales · 47 conversaciones · 12 links", () => {
    let data = emptyDraft();
    for (const ch of ["instagram", "whatsapp", "linkedin"]) data = setChannelSelected(data, ch, true);
    data = setDraftValue(data, "instagram", "conv_inbound", 20);
    data = setDraftValue(data, "whatsapp", "conv_outbound", 27);
    data = setDraftValue(data, "instagram", "links_enviados", 5);
    data = setDraftValue(data, "linkedin", "links_enviados", 7);
    expect(summaryLine({ fields: def.fields, channels: def.channels!, hasChannels: true, data })).toBe("3 canales · 47 conversaciones · 12 links");
  });

  it("un canal apagado no suma, y se avisa que tiene datos", () => {
    let data = setDraftValue(setChannelSelected(emptyDraft(), "instagram", true), "instagram", "links_enviados", 2);
    data = setChannelSelected(setDraftValue(data, "whatsapp", "links_enviados", 9), "whatsapp", false);
    expect(summaryLine({ fields: def.fields, channels: def.channels!, hasChannels: true, data })).toBe("1 canal · 2 links");
    expect(hasDataInUnselected(data)).toBe(true);
  });

  it("apagar un canal no borra lo cargado", () => {
    let data = setDraftValue(setChannelSelected(emptyDraft(), "instagram", true), "instagram", "respuestas", 4);
    data = setChannelSelected(data, "instagram", false);
    data = setChannelSelected(data, "instagram", true);
    expect(getDraftValue(data, "instagram", "respuestas")).toBe(4);
  });
});
