import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/cron/purge-deleted
 *
 * Autenticacion: header `Authorization: Bearer <CRON_SECRET>`. La query string
 * `?key=` ya no autoriza (un secreto en la URL queda en los logs del proxy y en
 * la tabla de pg_net). Lo manda asi private.call_app_cron, migracion 00036.
 *
 * Borra de verdad lo que lleva mas de 30 dias marcado como eliminado (F15):
 * contactos, notas, conversaciones y templates de respuesta.
 *
 * Nada se borra en el momento — se marca con deleted_at y desaparece de los
 * listados — asi que un borrado por error se puede deshacer durante un mes.
 * Este cron es el que cierra esa ventana.
 *
 * El trabajo pesado lo hace purge_soft_deleted (migracion 00025): una sola
 * transaccion, y el cascade de las FK se lleva mensajes, tags y campos
 * personalizados de cada contacto purgado. La funcion es solo para service_role,
 * asi que ni un Owner puede dispararla desde el navegador.
 *
 * Diario, no cada minuto: la retencion se mide en dias.
 */
export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = await createServiceClient();

  const { data, error } = await supabase.rpc("purge_soft_deleted", {
    p_retention_days: 30,
  });

  if (error) {
    console.error("[cron/purge-deleted] la purga fallo:", error.message);
    return NextResponse.json({ error: "purge failed" }, { status: 500 });
  }

  // Se loguea solo cuando borro algo: un log diario que dice "0" no lo lee nadie.
  const purged =
    (data?.contacts ?? 0) +
    (data?.conversations ?? 0) +
    (data?.contact_notes ?? 0) +
    (data?.response_templates ?? 0);

  if (purged > 0) {
    console.log("[cron/purge-deleted] purgados:", JSON.stringify(data));
  }

  return NextResponse.json({ ok: true, ...data });
}
