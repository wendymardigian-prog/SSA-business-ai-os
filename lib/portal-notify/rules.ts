// @plantilla-quitar(servicios)
/**
 * Avisos del estudiante (F128, decisiones 471 y 475), puro. Gemelas de `app_servicio.portal_notification_prefs` y
 * `app_servicio.portal_active_days_plan` (00377); los casos de `rules.cases.json` corren contra las dos.
 */

/** Lo que elige en Perfil (F252 del portal). Lo que no eligió toma el valor por defecto. */
export const NOTIFICATION_PREF_DEFAULTS = {
  weekly_digest: true,
  due_today_email: false,
  review_done: true,
  community_reply: true,
  announcements: true,
} as const;
export type NotificationPrefKey = keyof typeof NOTIFICATION_PREF_DEFAULTS;
export type NotificationPrefs = Record<NotificationPrefKey, boolean>;

/** Las preferencias efectivas: las guardadas (solo claves conocidas y sí/no) sobre las de por defecto. */
export function notificationPrefs(saved: unknown): NotificationPrefs {
  const out = { ...NOTIFICATION_PREF_DEFAULTS } as NotificationPrefs;
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    for (const k of Object.keys(NOTIFICATION_PREF_DEFAULTS) as NotificationPrefKey[]) {
      const v = (saved as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

export const ACTIVE_DAYS_KEEP = 180;

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/**
 * Los días que entró al portal (decisión 475): suma hoy si no está y deja solo los últimos 180 días, ordenados. null =
 * no hay nada que escribir (hoy ya estaba): como mucho una escritura por estudiante por día.
 */
export function activeDaysPlan(days: readonly string[], today: string): string[] | null {
  if (days.includes(today)) return null;
  const from = addDays(today, -(ACTIVE_DAYS_KEEP - 1));
  return [...new Set([...days, today])].filter((d) => d >= from && d <= today).sort();
}
