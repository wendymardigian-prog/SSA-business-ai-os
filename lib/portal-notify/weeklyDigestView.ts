// @plantilla-quitar(servicios)
// Gemela de lib/portal/weeklyDigestView.ts del portal (F128/F252): mismos casos, para que el panel arme el email igual que el portal la campana.
export interface DigestSection {
  key: string;
  title: string;
  text: string;
}

const ORDER: [string, string][] = [
  ["done", "Lo que hiciste"], ["pending", "Lo que tenés pendiente"], ["challenge", "Tu reto"], ["content", "Contenido nuevo"],
  ["community", "En la comunidad"], ["projects", "Tus proyectos"], ["fame", "Sala de la fama"], ["referrals", "Mis referidos"],
];

/**
 * El resumen semanal por email (F252): una sección por cosa y solo las que tienen algo. Mis referidos va siempre
 * al final, con su link.
 */
export function weeklyDigestView(data: { key: string; text: string | null }[], referralsText: string): DigestSection[] {
  const byKey = new Map(data.map((d) => [d.key, d.text]));
  const out: DigestSection[] = [];
  for (const [key, title] of ORDER) {
    if (key === "referrals") continue;
    const text = byKey.get(key);
    if (text) out.push({ key, title, text });
  }
  out.push({ key: "referrals", title: "Mis referidos", text: byKey.get("referrals") || referralsText });
  return out;
}
