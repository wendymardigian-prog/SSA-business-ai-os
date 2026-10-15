import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { PageHeader } from "@/components/page-header";
import { TouchTimelineList } from "@/components/contacts/touch-timeline-list";
import { loadContactTouchTimeline, TIMELINE_FETCH_LIMIT } from "@/lib/contacts/load-touches";
import { loadMetaNames } from "@/lib/contacts/meta-names";
import { buildTimeline, TIMELINE_PAGE_SIZE } from "@/lib/contacts/touch-timeline";
import { adDetailHref } from "@/lib/meta/content-ad-summary";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Todos los toques de un contacto (Extra I, F45): la lista completa, del mas nuevo al mas viejo, de a 50.
 *
 * Lee con el cliente de la persona: la RLS decide si ve al contacto y sus toques (un Member, solo los de los leads que
 * puede ver). Las marcas Primer toque / Último toque / Último con origen se calculan sobre TODOS los toques, no solo
 * sobre la pagina que se muestra. Los nombres de campaña, conjunto y anuncio (y el link al anuncio) solo aparecen si la
 * persona puede ver el dashboard de anuncios: la RLS del catalogo no devuelve nada si no.
 */
export default async function ContactTouchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("contacts.view");
  const { contactId } = await params;
  if (!UUID.test(contactId)) notFound();
  const { supabase, workspace } = ctx;
  const sp = await searchParams;
  const rawPage = Number(Array.isArray(sp.pagina) ? sp.pagina[0] : sp.pagina);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, display_name, email")
    .eq("id", contactId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) notFound();

  const [timeZone, loaded] = await Promise.all([
    resolveViewerTimezone(workspace.timezone),
    loadContactTouchTimeline(supabase, workspace.id, contactId),
  ]);
  const name = contact.display_name || contact.email || "Contacto sin nombre";

  if (loaded.error) {
    console.error("[contactos] no pude leer los toques:", loaded.error.message);
    return <TouchesShell contactId={contact.id} name={name}><p role="alert" className="text-sm text-destructive">No pude cargar los toques. Probá de nuevo en un momento.</p></TouchesShell>;
  }

  // Primero se arma la pagina SIN nombres para saber que toques se van a mostrar; despues se piden solo los nombres
  // (y los formularios) de esos toques y se vuelve a armar. Son cuentas puras, no cuestan nada.
  const first = buildTimeline(loaded.data, { page, timeZone });
  const shown = new Set(first.items.map((i) => i.id));
  const pageRows = loaded.data.filter((t) => shown.has(t.id));

  const formIds = [
    ...new Set(
      pageRows
        .filter((t) => t.origin === "form")
        .map((t) => (t.raw as { source_id?: unknown } | null)?.source_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const formNames: Record<string, string> = {};
  if (formIds.length > 0) {
    const { data: formRows } = await supabase.from("forms").select("id, name").eq("workspace_id", workspace.id).in("id", formIds);
    for (const f of (formRows ?? []) as { id: string; name: string }[]) formNames[f.id] = f.name;
  }
  const names = await loadMetaNames(supabase, workspace.id, pageRows);
  const timeline = buildTimeline(loaded.data, { page, timeZone, formNames, names });

  // El link al detalle del anuncio: solo para quien puede ver anuncios (la RLS del catalogo lo confirma).
  const adHrefs: Record<string, string> = {};
  const adIds = [...new Set(timeline.items.map((i) => i.adId).filter((id): id is string => Boolean(id)))];
  if (ctx.can("dashboards.ads.view") && adIds.length > 0) {
    const { data: adRows } = await supabase.from("meta_ads").select("ad_id, ad_account_id").eq("workspace_id", workspace.id).in("ad_id", adIds);
    for (const ad of (adRows ?? []) as { ad_id: string; ad_account_id: string }[]) adHrefs[ad.ad_id] = adDetailHref(ad.ad_id, ad.ad_account_id);
  }

  const base = `/dashboard/contacts/${contact.id}/toques`;

  return (
    <TouchesShell contactId={contact.id} name={name} total={timeline.total}>
      {loaded.truncated && (
        <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
          Este contacto tiene más de {TIMELINE_FETCH_LIMIT.toLocaleString("es-AR")} toques: se muestran los más nuevos.
        </p>
      )}
      {timeline.total === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Todavía no hay toques de este contacto. Se registran solos cuando escribe, comenta, hace clic en un link, agenda o responde un formulario.
        </p>
      ) : (
        <TouchTimelineList items={timeline.items} timeZone={timeZone} adHrefs={adHrefs} />
      )}
      {timeline.pageCount > 1 && (
        <nav aria-label="Páginas" className="mt-4 flex items-center gap-3 text-sm">
          {timeline.hasPrev && (
            <Link href={`${base}?pagina=${timeline.page - 1}`} className="underline-offset-2 hover:underline">
              ← Más nuevos
            </Link>
          )}
          <span className="text-muted-foreground">
            Página {timeline.page} de {timeline.pageCount} · {TIMELINE_PAGE_SIZE} por página
          </span>
          {timeline.hasNext && (
            <Link href={`${base}?pagina=${timeline.page + 1}`} className="underline-offset-2 hover:underline">
              Más viejos →
            </Link>
          )}
        </nav>
      )}
    </TouchesShell>
  );
}

function TouchesShell({ contactId, name, total, children }: { contactId: string; name: string; total?: number; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={`Toques de ${name}`} tooltip="Todas las veces que esta persona interactuó, del más nuevo al más viejo, con el canal y de dónde vino cada una." />
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <p className="mb-3 text-sm">
          <Link href={`/dashboard/contacts/${contactId}`} className="text-primary underline-offset-2 hover:underline">
            Volver a la ficha
          </Link>
          {total !== undefined && (
            <span className="ml-3 text-muted-foreground">
              {total === 1 ? "1 toque" : `${total.toLocaleString("es-AR")} toques`}
            </span>
          )}
        </p>
        <div className="mx-auto max-w-3xl">{children}</div>
      </div>
    </div>
  );
}
