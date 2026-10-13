import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { UnlinkedList } from "@/components/dashboards/ads/unlinked-list";
import { loadUnlinked } from "@/lib/attribution/unlinked-load";
import { parseDays, parsePage, parseView } from "@/lib/attribution/unlinked-view";
import { resolveViewerTimezone } from "@/lib/user-timezone";

export const dynamic = "force-dynamic";

/**
 * «Sin vincular» (Extra L, AT3, F29): los toques que traen datos de un anuncio y no se pudieron asociar a su
 * campaña, conjunto o anuncio, con el motivo en palabras. Se puede vincular a mano o ignorar.
 *
 * Ver: `dashboards.ads.view`. Vincular, ignorar o quitar: `settings.manage`. La lista se lee con la sesion de
 * quien mira, asi que respeta el alcance de leads (RLS de `contact_touches`).
 */
export default async function UnlinkedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("dashboards.ads.view");
  const sp = await searchParams;

  const view = parseView(sp.vista);
  const days = parseDays(sp.dias);
  const page = parsePage(sp.pagina);
  const timeZone = await resolveViewerTimezone(ctx.workspace.timezone);

  const data = await loadUnlinked(ctx.supabase, { workspaceId: ctx.workspace.id, view, days, page, timeZone });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/dashboards/ads/sin-vincular"
        backHref={
          <Link
            href="/dashboard/dashboards/ads"
            aria-label="Volver al dashboard de anuncios"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        }
      />
      <UnlinkedList data={data} view={view} days={days} canManage={ctx.can("settings.manage")} />
    </div>
  );
}
