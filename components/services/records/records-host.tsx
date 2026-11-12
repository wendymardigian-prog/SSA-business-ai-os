// @plantilla-quitar(servicios)
import { parseRecordParams } from "@/lib/services/screens/record-url";
import type { PermissionContext } from "@/lib/auth/guards";
import { ClientRecord } from "./client-record";
import { ServiceRecord } from "./service-record";

/**
 * La ficha que pide la URL (`?cliente=` o `?servicio=`), encima de la lista de Clientes (Servicios A2). La pagina ya
 * pidio `services.view` y el modulo prendido; cada ficha vuelve a leer con la sesion de quien mira.
 */
export async function RecordsHost({ ctx, searchParams }: { ctx: Pick<PermissionContext, "workspace" | "supabase" | "can" | "permissions" | "user">; searchParams: Record<string, string | string[] | undefined> }) {
  const r = parseRecordParams(searchParams);
  if (r.kind === "service") return <ServiceRecord ctx={ctx} serviceId={r.id} tab={r.tab} />;
  if (r.kind === "client") return <ClientRecord ctx={ctx} contactId={r.id} />;
  return null;
}
