/**
 * La zona horaria con la que se muestra la agenda a quien mira (F8):
 * la del perfil de agenda; si no tiene perfil, la del navegador; si tampoco,
 * la del workspace. Puro.
 */

import { isValidTimeZone, DEFAULT_TIMEZONE } from "@/lib/timezone";

export function getViewerTimezone(input: {
  profileTimezone?: string | null;
  browserTimezone?: string | null;
  workspaceTimezone?: string | null;
}): string {
  for (const tz of [input.profileTimezone, input.browserTimezone, input.workspaceTimezone]) {
    if (tz && isValidTimeZone(tz)) return tz;
  }
  return DEFAULT_TIMEZONE;
}
