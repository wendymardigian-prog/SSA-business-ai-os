import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { processSequenceSteps } from "@/lib/sequences/processor";

/**
 * Cron job handler that processes sequence enrollments.
 * Lo llama pg_cron cada minuto (migracion 00036).
 * GET /api/cron/sequences
 *
 * Autenticacion: header `Authorization: Bearer <CRON_SECRET>`. La query string
 * `?key=` ya no autoriza (un secreto en la URL queda en los logs del proxy y en
 * la tabla de pg_net). Lo manda asi private.call_app_cron, migracion 00036.
 */
export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  try {
    const result = await processSequenceSteps();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Sequence cron failed:", err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
