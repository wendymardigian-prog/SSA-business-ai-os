import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { loadMyEods, type MyEodItem } from "@/lib/eod/load";
import { resolveViewerTimezone } from "@/lib/user-timezone";

export const dynamic = "force-dynamic";

/**
 * "Mi reporte del día" (E6): los reportes de fin de día que le tocan a la persona de la
 * sesión, con el estado de hoy. Si tiene uno solo, entra directo. Completarlo no necesita
 * permiso: alcanza con estar en la audiencia de un EOD publicado.
 */
export default async function MiReporteDelDiaPage() {
  const ctx = await getPermissionContext();
  const service = await createServiceClient();
  const [{ items }, timeZone] = await Promise.all([loadMyEods(service, ctx.workspace.id, ctx.user.id), resolveViewerTimezone(ctx.workspace.timezone)]);
  if (items.length === 1) redirect(`/dashboard/eod/${items[0].formId}`);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/eod" />
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {items.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border py-16 text-center">
            <ClipboardList className="h-10 w-10 text-muted-foreground/50" aria-hidden />
            <p className="font-medium text-muted-foreground">No tenés reportes de fin de día para completar</p>
            <p className="max-w-sm text-sm text-muted-foreground">Cuando se publique un reporte para tu rol o para vos, lo vas a ver acá.</p>
          </div>
        ) : (
          <ul className="mx-auto flex max-w-2xl flex-col gap-2">
            {items.map((item) => (
              <li key={item.formId}>
                <Link href={`/dashboard/eod/${item.formId}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-4 hover:shadow-md">
                  <ClipboardList className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.roleLabel}</span>
                  </span>
                  <StatusChip status={item.status} timeZone={timeZone} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status, timeZone }: { status: MyEodItem["status"]; timeZone: string }) {
  if (status.kind === "submitted") {
    const at = status.at ? new Date(status.at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone }) : "";
    return <span className="shrink-0 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs text-green-700 dark:text-green-300">Enviado{at ? ` a las ${at}` : ""}</span>;
  }
  if (status.kind === "draft") {
    return <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">En curso · {status.loaded} cargados</span>;
  }
  return <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Sin empezar</span>;
}
