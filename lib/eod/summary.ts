/**
 * La barra de abajo del reporte: "3 canales · 47 conversaciones · 12 links". Puro.
 */
import type { FormField } from "@/lib/forms/fields";
import { computeEodMetrics, TOTAL_SCOPE } from "./metrics";
import { selectedChannelKeys, type EodDraftData } from "./draft";
import type { EodChannel } from "./types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summaryLine(input: { fields: FormField[]; channels: EodChannel[]; hasChannels: boolean; data: EodDraftData }): string {
  const active = input.channels.filter((c) => c.enabled);
  const selected = selectedChannelKeys(input.data).filter((k) => active.some((c) => c.key === k));
  const metrics = computeEodMetrics({
    generalFields: input.fields,
    generalAnswers: input.data.answers,
    channels: active,
    channelAnswers: Object.fromEntries(Object.entries(input.data.channels).map(([k, c]) => [k, c.answers])),
    selectedKeys: selected,
  });
  const total = metrics[TOTAL_SCOPE] ?? {};
  const parts: string[] = [];
  if (input.hasChannels) parts.push(plural(selected.length, "canal", "canales"));
  const conversations = (total.conv_inbound ?? 0) + (total.conv_outbound ?? 0);
  if ("conv_inbound" in total || "conv_outbound" in total) parts.push(plural(conversations, "conversación", "conversaciones"));
  if ("links_enviados" in total) parts.push(plural(total.links_enviados, "link", "links"));
  if ("llamadas_agendadas" in total) parts.push(plural(total.llamadas_agendadas, "llamada", "llamadas"));
  return parts.join(" · ");
}

/** ¿Hay algo cargado en un canal apagado? (No se envía: la barra lo dice.) */
export function hasDataInUnselected(data: EodDraftData): boolean {
  return Object.values(data.channels).some((c) => !c.selected && Object.values(c.answers).some((v) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)));
}
