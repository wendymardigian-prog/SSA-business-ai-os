/**
 * Que proveedores se pueden conectar por OAuth.
 *
 * Sumar uno es escribir su adaptador y agregarlo aca: las rutas
 * `/api/oauth/[provider]/start` y `/callback` no se tocan.
 */

import type { OAuthProvider } from "@/lib/types/database";
import { googleAdapter } from "@/lib/social/google";
import { linkedinAdapter } from "@/lib/social/linkedin";
import { threadsAdapter } from "@/lib/social/threads/auth";
import { googleCalendarAdapter } from "@/lib/social/google-calendar";
import type { OAuthAdapter } from "./types";

export const OAUTH_ADAPTERS: Record<OAuthProvider, OAuthAdapter> = {
  google: googleAdapter,
  linkedin: linkedinAdapter,
  threads: threadsAdapter,
  google_calendar: googleCalendarAdapter,
};

export function getOAuthAdapter(provider: string): OAuthAdapter | undefined {
  return OAUTH_ADAPTERS[provider as OAuthProvider];
}
