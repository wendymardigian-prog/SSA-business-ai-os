import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { HeaderTabs } from "@/components/ui/header-tabs";
import { BackLink } from "@/components/ui/back-link";
import { IDEA_FILTERS, IDEA_FILTER_LABELS, loadIdeasList, parseIdeaFilter } from "@/lib/content/ideas-list";
import { IdeasTable } from "@/components/content/ideas-table";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { loadPendingContentProposals, type PendingContentProposal } from "@/lib/calls/content-proposals-load"; // @plantilla-quitar(llamadas)

export const dynamic = "force-dynamic";

/**
 * Contenido › Ideas (traído de RER, B-IA-31): cada idea del banco con su estado, la pieza que salió de ella y de
 * dónde salió (la grabación, un agente o una persona). Arriba, las propuestas de contenido de las grabaciones que
 * todavía esperan: se aprueban en la reunión, con su cita, y recién ahí entran al banco.
 */

const EMPTY: Record<string, string> = {
  aprobada: "Todavía no hay ideas aprobadas. Cuando apruebes una en el tablero, aparece acá con su pieza.",
  nueva: "No hay ideas nuevas esperando en el tablero.",
  descartada: "No hay ideas descartadas.",
  todas: "Todavía no hay ideas. Salen de las grabaciones, de los agentes o las escribe el equipo.",
};

export default async function ContentIdeasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const ctx = await requirePermission("content.view");
  const { supabase, workspace } = ctx;
  const filter = parseIdeaFilter(params.estado);
  const [data, timeZone] = await Promise.all([loadIdeasList(supabase, workspace.id, filter), resolveViewerTimezone(workspace.timezone)]);
  // @plantilla-desde(llamadas)
  const pendingProposals = ctx.can("calls.view") ? await loadPendingContentProposals(supabase, workspace.id) : [];
  // @plantilla-hasta(llamadas)

  const tabs = IDEA_FILTERS.map((f) => ({
    key: f,
    label: IDEA_FILTER_LABELS[f],
    href: f === "aprobada" ? "/dashboard/content/ideas" : `/dashboard/content/ideas?estado=${f}`,
    count: data.counts[f],
  }));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/content/ideas"
        backHref={<BackLink href="/dashboard/content" label="Volver a Contenido" />}
        tabs={<HeaderTabs items={tabs} active={filter} label="Estado de las ideas" />}
      />
      <div className="flex flex-1 flex-col gap-4 overflow-auto px-4 py-6 md:px-8">
        {pendingProposals.length > 0 && <PendingFromCalls items={pendingProposals} timeZone={timeZone} />} {/* @plantilla-quitar(llamadas) */}

        {data.error && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{data.error}</p>}

        {!data.error && data.rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{EMPTY[filter]}</div>
        )}

        {data.rows.length > 0 && <IdeasTable rows={data.rows} timeZone={timeZone} />}
      </div>
    </div>
  );
}

// @plantilla-desde(llamadas)
/** Las propuestas de contenido que esperan en las grabaciones: se deciden en la reunión (ahí está la cita). */
function PendingFromCalls({ items, timeZone }: { items: PendingContentProposal[]; timeZone: string }) {
  const fmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone });
  const total = items.reduce((n, c) => n + c.items.length, 0);
  return (
    <section aria-labelledby="pending-content-proposals" className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
      <h2 id="pending-content-proposals" className="flex items-center gap-2 text-sm font-semibold">
        <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
        {total === 1 ? "1 propuesta de las grabaciones espera aprobación" : `${total} propuestas de las grabaciones esperan aprobación`}
      </h2>
      <p className="text-xs text-muted-foreground">Se aprueban, editan o descartan en cada reunión, con la frase del cliente a la vista. Al aprobarlas, la idea entra al tablero como nueva y el borrador nace como pieza en Borrador.</p>
      <ul className="space-y-1.5">
        {items.map((c) => (
          <li key={c.callId} className="text-sm">
            <Link href={`/dashboard/llamadas/${c.callId}`} className="font-medium text-primary-ink hover:underline">
              {c.callTitle}
            </Link>{" "}
            <span className="text-xs text-muted-foreground">· {fmt.format(new Date(c.recordedAt))}</span>
            <ul className="ml-4 mt-0.5 list-disc text-xs text-muted-foreground">
              {c.items.map((i) => (
                <li key={i.id}>
                  {i.typeLabel}: {i.title}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
// @plantilla-hasta(llamadas)
