// @plantilla-quitar(servicios)
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/auth/guards";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { addableProducts, programCards, type ProgramProductRow, type ProgramVariantRow } from "@/lib/portal-admin/programs";
import { PageHeader } from "@/components/page-header";
import { EmptyHint } from "@/components/contacts/ui";
import { AddProgramDialog } from "@/components/services/portal/add-program-dialog";
import { ReviewList } from "@/components/services/portal/review-list";
import { TopbarTabs } from "@/components/ui/topbar-tabs";
import { SettingsLinkButton } from "@/components/ui/settings-link-button";
import { loadReviewItems } from "@/lib/program/load-review";
import { REVIEW_FILTERS, parseReviewFilter, reviewFilterCounts } from "@/lib/program/review";
import { UrlQuickFilterMenu } from "@/components/ui/topbar-controls";
import { countPendingSubmissions, loadUnansweredComments, pendingReviewTotal } from "@/lib/portal-admin/review-count";
import { svcRpc } from "@/lib/services/db";
import { cardMetricViews, parseMetricDays, type CardMetrics } from "@/lib/portal-admin/card-metrics";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Portal (F35, F43): Programas (los productos con portal y «+ Agregar programa») y Por revisar, como pestañas en la
 * barra superior (`TopbarTabs`, con el contador de lo que espera revisión). Los ajustes del portal son el engranaje
 * de la barra (`/dashboard/portal/ajustes`); el link viejo `?tab=ajustes` lleva ahí. Pide alguna clave del portal;
 * cada pestaña la suya. Con el módulo apagado, 404. Se lee con la sesión de quien mira.
 */
export default async function PortalPage({ searchParams }: { searchParams: Promise<{ tab?: string; estudiante?: string; dias?: string; programa?: string; filtro?: string }> }) {
  const ctx = await requireAnyPermission(["portal.view", "portal.sections", "portal.access_rules", "portal.settings", "submissions.review", "community.view"]);
  const { workspace, supabase } = ctx;
  if (!moduleShows("route.portal", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  const sp = await searchParams;
  const canSettings = ctx.can("portal.settings") || ctx.can("portal.view");
  if (sp.tab === "ajustes" && canSettings) redirect("/dashboard/portal/ajustes");
  const canReview = ctx.can("portal.view") || ctx.can("submissions.review") || ctx.can("community.view");
  const tabs = [
    { key: "programas", label: "Programas", show: ctx.can("portal.view") || ctx.can("portal.sections") || ctx.can("portal.access_rules") },
    { key: "revisar", label: "Por revisar", show: canReview },
  ].filter((t) => t.show);
  // Quien solo puede ver los ajustes no tiene pestañas: va directo a la pantalla de ajustes.
  if (tabs.length === 0) redirect("/dashboard/portal/ajustes");
  const tab = tabs.find((t) => t.key === sp.tab) ?? tabs[0];

  // Lo que espera revisión: el contador de la pestaña y, en «Por revisar», la lista de comentarios (una sola lectura).
  const service = await createServiceClient();
  const [pendingSubmissions, comments] = canReview
    ? await Promise.all([countPendingSubmissions(service, workspace.id), ctx.can("community.view") ? loadUnansweredComments(supabase, workspace.id) : Promise.resolve([])])
    : [0, []];
  const pendingTotal = pendingReviewTotal(pendingSubmissions, comments);

  let body: React.ReactNode;
  let addButton: React.ReactNode = null;
  let periodFilter: React.ReactNode = null;
  let quickFilter: React.ReactNode = null;
  if (tab.key === "revisar") {
    // Por revisar (F57): las entregas de todos los programas, leídas con el cliente de servicio después del permiso.
    const items = await loadReviewItems(service, workspace.id, { contactId: sp.estudiante && /^[0-9a-f-]{36}$/i.test(sp.estudiante) ? sp.estudiante : null, productId: sp.programa && /^[0-9a-f-]{36}$/i.test(sp.programa) ? sp.programa : null });
    // El filtro de las entregas va en la barra superior (Servicios A2), con el conteo de cada opción.
    const filter = parseReviewFilter(sp.filtro);
    const counts = reviewFilterCounts(items);
    quickFilter = <UrlQuickFilterMenu param="filtro" value={filter} allKey="pending" label="Entregas" options={REVIEW_FILTERS.map((f) => ({ key: f.key, label: f.label, count: counts[f.key] }))} />;
    // Comentarios (F111): lo sin contestar de la comunidad y de las clases, por programa (con community.view).
    body = (
      <div className="space-y-6">
        <ReviewList items={items} filter={filter} canReview={ctx.can("submissions.review")} timeZone={await resolveViewerTimezone((workspace as { timezone?: string }).timezone)} />
        {ctx.can("community.view") && (
          <section aria-labelledby="comentarios" className="space-y-2">
            <h2 id="comentarios" className="text-sm font-semibold">Comentarios</h2>
            {comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay comentarios sin contestar en los últimos 30 días.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {comments.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>{c.name}</span>
                    <Link href={`/dashboard/portal/${c.id}?tab=comunidad&filtro=sin-contestar`} className="text-xs text-primary-ink hover:underline">
                      {c.unanswered === 1 ? "1 sin contestar" : `${c.unanswered} sin contestar`}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    );
  } else {
    const [{ data: products }, { data: variants }] = await Promise.all([
      supabase.from("products").select("id, name, status, portal_enabled, portal_settings").eq("workspace_id", workspace.id).is("archived_at", null),
      supabase.from("product_variants").select("id, product_id, name, portal_settings").eq("workspace_id", workspace.id).is("archived_at", null),
    ]);
    const p = (products ?? []) as unknown as ProgramProductRow[];
    const v = (variants ?? []) as unknown as ProgramVariantRow[];
    const cards = programCards(p, v);
    if (ctx.can("portal.sections")) addButton = <AddProgramDialog products={addableProducts(p, v)} />;
    // Las métricas de las cards (F108), en una consulta, con services.view o program.manage.
    const days = parseMetricDays(sp.dias);
    const canMetrics = ctx.can("services.view") || ctx.can("program.manage");
    const metrics = canMetrics && cards.length ? await svcRpc<Record<string, CardMetrics>>(supabase, "program_card_metrics", { p_product_ids: cards.map((c) => c.id), p_days: days }) : null;
    const byProduct = metrics?.ok ? metrics.data ?? {} : {};
    // El período de las métricas es un filtro de la pantalla: va en la barra, como en los dashboards.
    if (canMetrics && cards.length) {
      periodFilter = (
        <nav className="flex items-center gap-1 text-xs" aria-label="Período de las métricas">
          {([7, 30] as const).map((d) => (
            <Link key={d} href={`/dashboard/portal?tab=programas&dias=${d}`} aria-current={d === days ? "page" : undefined} className={cn("inline-flex h-8 max-topbar:h-10 items-center whitespace-nowrap rounded-full border px-3", d === days ? "border-primary-edge bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}>
              Últimos {d} días
            </Link>
          ))}
        </nav>
      );
    }
    body =
      cards.length === 0 ? (
        <EmptyHint>Todavía no hay programas en el portal. Agregá uno: elegís el producto y qué variantes tienen acceso.</EmptyHint>
      ) : (
        <div className="space-y-3">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <li key={c.id} className="flex h-full flex-col rounded-xl border border-border bg-card p-4">
                <Link href={`/dashboard/portal/${c.id}`} className="block hover:underline">
                  <p className="text-sm font-semibold text-foreground">{c.name}</p>
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.variantsWithAccess} de {c.variantsTotal} variantes con acceso
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{c.sectionsOn.join(" · ") || "Sin secciones prendidas"}</p>
                {canMetrics && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    {cardMetricViews(c.id, byProduct[c.id]).map((m) => (
                      <div key={m.key} className="flex items-baseline justify-between gap-2">
                        <dt className="text-muted-foreground">{m.label}</dt>
                        <dd className={cn("font-medium", m.highlight && "text-warn")}>{m.href ? <Link href={m.href} className="hover:underline">{m.value}</Link> : m.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </div>
      );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/portal"
        tabs={
          <TopbarTabs
            label="Secciones del Portal"
            active={tab.key}
            tabs={tabs.map((t) => ({
              key: t.key,
              label: t.label,
              href: `/dashboard/portal?tab=${t.key}`,
              count: t.key === "revisar" ? pendingTotal : null,
              countLabel: "esperando revisión",
            }))}
          />
        }
        filters={periodFilter}
        quickFilter={quickFilter}
        right={
          <>
            {canSettings && <SettingsLinkButton href="/dashboard/portal/ajustes" label="Ajustes del portal" />}
            {addButton}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-4 p-4 md:p-6">{body}</div>
      </div>
    </div>
  );
}
