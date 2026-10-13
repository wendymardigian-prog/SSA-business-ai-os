import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { endOfDay, startOfDay } from "@/lib/dates";
import { loadEndpointDetail, loadHistory } from "@/lib/webhooks/queries";
import { EndpointDetailScreen } from "@/components/webhooks/endpoint-detail";
import type { InboundStatus } from "@/lib/webhooks/types";

const STATUSES: readonly string[] = ["received", "processing", "processed", "error", "ignored", "captured", "paused"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (value: string): [number, number, number] => {
  const [y, m, d] = value.split("-").map(Number);
  return [y, m, d];
};

/**
 * Un endpoint: su URL, el ejemplo, y el historial de envios con el payload. Solo `flows.edit`:
 * el payload tiene datos personales y la URL es una credencial.
 */
export default async function WebhookEndpointPage({
  params,
  searchParams,
}: {
  params: Promise<{ endpointId: string }>;
  searchParams: Promise<{ estado?: string; desde?: string; hasta?: string; pagina?: string }>;
}) {
  const { endpointId } = await params;
  const query = await searchParams;
  const ctx = await requirePermission("flows.edit");
  const db = await createServiceClient();

  const endpoint = await loadEndpointDetail(db, ctx.workspace.id, endpointId);
  if (!endpoint) notFound();

  const timeZone = await resolveViewerTimezone((ctx.workspace as { timezone?: string }).timezone);
  const status = query.estado && STATUSES.includes(query.estado) ? (query.estado as InboundStatus) : "all";
  const from = query.desde && DATE.test(query.desde) ? query.desde : "";
  const to = query.hasta && DATE.test(query.hasta) ? query.hasta : "";
  const page = Math.max(1, Number.parseInt(query.pagina ?? "1", 10) || 1);

  const history = await loadHistory(db, ctx.workspace.id, endpointId, {
    status,
    // Las fechas del filtro son civiles en la zona de quien mira: se convierten al rango UTC.
    from: from ? startOfDay(...ymd(from), timeZone).toISOString() : null,
    to: to ? endOfDay(...ymd(to), timeZone).toISOString() : null,
    page,
  });

  return <EndpointDetailScreen endpoint={endpoint} history={history} filters={{ status, from, to }} timeZone={timeZone} />;
}
