import { NextResponse, after, type NextRequest } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Recolección de los lotes de IA en segundo plano (F24). Cada 15 min consulta
 * los lotes pendientes, escribe los resultados y cierra el run. El pipeline de
 * lote real (o pedidos agrupados que ejecutan el clasificador) está pendiente:
 * ver docs/PENDIENTE.md. Por ahora la ruta existe, está autorizada y no hace
 * trabajo (no hay lotes en vuelo con el agente apagado).
 */
export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;
  after(async () => {
    // TODO(bloque 5): consultar lotes pendientes y escribir resultados.
  });
  return NextResponse.json({ ok: true, queued: true });
}
