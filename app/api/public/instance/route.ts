import { NextResponse } from "next/server";
import { instanceFingerprint } from "@/lib/settings/domain-check";

/**
 * `GET /api/public/instance`: la huella de esta instalación (`lib/settings/domain-check.ts`). La pide Ajustes → General
 * para comprobar que un dominio propio llega a este sistema antes de guardarlo. Pública y sin datos: la huella sale de
 * la URL de Supabase, que ya es pública.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ instance: instanceFingerprint() }, { headers: { "Cache-Control": "no-store" } });
}
