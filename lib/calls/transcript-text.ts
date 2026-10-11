/**
 * La transcripcion de una llamada como texto para el modelo: una linea por
 * intervencion, `[hora] Quien: lo que dijo`. Pura. La usan la clasificacion, el
 * analisis, la correccion y el resumen, asi todas ven exactamente lo mismo (y
 * las citas se verifican contra este mismo texto).
 */
export function transcriptText(transcript: unknown): string {
  if (!Array.isArray(transcript)) return typeof transcript === "string" ? transcript : "";
  return transcript
    .map((u: { speaker?: { display_name?: string | null } | null; text?: string | null; timestamp?: string | null }) =>
      `[${u?.timestamp ?? ""}] ${u?.speaker?.display_name ?? "?"}: ${u?.text ?? ""}`,
    )
    .join("\n");
}

/** Los invitados como una lista corta para el prompt: "Nombre <email> (externo)". */
export function attendeesText(attendees: unknown): string {
  if (!Array.isArray(attendees) || attendees.length === 0) return "(sin invitados)";
  return attendees
    .map((a: { name?: string | null; email?: string | null; is_external?: boolean | null }) => {
      const who = [a?.name, a?.email ? `<${a.email}>` : null].filter(Boolean).join(" ") || "?";
      return `- ${who}${a?.is_external ? " (externo)" : ""}`;
    })
    .join("\n");
}
