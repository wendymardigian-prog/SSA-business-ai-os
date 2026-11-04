import { NextResponse, type NextRequest } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { runSendQueue } from "@/lib/send-queue/dispatch";

/**
 * La cola de envíos masivos (docs/broadcasts.md). La llama pg_cron cada 15
 * segundos (00286). Ruta propia y no el runner de /api/cron/jobs: ese toma 20
 * jobs por minuto con reintentos a los 10 s, y acá el ritmo lo pone cada número
 * (`lib/send-queue/pace.ts`), no la cola.
 *
 * Trabaja como mucho ~40 s por tic (la llamada de pg_net corta a los 60).
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = await createServiceClient();
  const summary = await runSendQueue(supabase);
  return NextResponse.json(summary);
}
