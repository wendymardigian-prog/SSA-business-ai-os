/**
 * Lo que tiene que estar completo para poner un broadcast en cola. Puro: la
 * pantalla lo usa para avisar antes de tocar el botón y el servidor lo vuelve a
 * mirar al confirmar (`queueBroadcast`).
 */
import { cleanVariants, unknownVariables } from "./render";
import type { BroadcastChannelKind } from "./audience";

export function draftProblems(
  b: { channel_id: string | null; message_variants: unknown; email_subject: string | null; email_preheader?: string | null },
  channelKind: BroadcastChannelKind | null,
  customFields: readonly { slug: string }[],
): string[] {
  const problems: string[] = [];
  if (!b.channel_id || !channelKind) problems.push("Elegí por qué canal sale.");
  const variants = cleanVariants(b.message_variants);
  if (variants.length === 0) problems.push(channelKind === "email" ? "Escribí el cuerpo del email." : "Escribí el mensaje.");
  if (channelKind === "email" && !(b.email_subject ?? "").trim()) problems.push("El email necesita un asunto.");
  const unknown = [...new Set([...variants, b.email_subject ?? "", b.email_preheader ?? ""].flatMap((t) => unknownVariables(t, customFields)))];
  if (unknown.length > 0) problems.push(`Estas variables no existen: ${unknown.map((v) => `{{${v}}}`).join(", ")}.`);
  return problems;
}
