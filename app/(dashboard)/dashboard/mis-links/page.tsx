// @plantilla-quitar(ventas)
import { requirePermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { publicBaseUrl } from "@/lib/public-url";
import { affRpc } from "@/lib/affiliates/rpc";
import {
  loadAffiliateSettings,
  loadLinkProducts,
  loadMemberCode,
  loadReferrals,
} from "@/lib/affiliates/load";
import { leadDisplayName, myLinksView } from "@/lib/affiliates/my-links";
import { toCents } from "@/lib/shared/money";
import { CopyLinkButton } from "@/components/scheduling/bookings/copy-link-button";
import { EmptyHint } from "@/components/contacts/ui";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

const usd = (cents: number) =>
  (cents / 100).toLocaleString("es-AR", { style: "currency", currency: "USD" });

/**
 * Mis links (F103): el código de la persona, los links de los productos para compartir y sus referidos. Pide
 * `affiliates.use`. El código se crea la primera vez que la persona entra (`affiliate_ensure_code`, con su sesión) y
 * no cambia nunca. Lo demás se lee con el cliente de servicio, filtrado por el negocio de la sesión y por la persona.
 */
export default async function MisLinksPage() {
  const ctx = await requirePermission("affiliates.use");
  const service = await createServiceClient();
  let code = await loadMemberCode(service, ctx.workspace.id, ctx.user.id);
  if (!code) {
    const made = await affRpc<string>(ctx.supabase, "affiliate_ensure_code", {
      p_workspace_id: ctx.workspace.id,
      p_kind: "member",
      p_id: ctx.user.id,
    });
    code = made.ok ? made.data : null;
  }
  const [products, refs, settings] = await Promise.all([
    loadLinkProducts(service, ctx.workspace.id),
    loadReferrals(service, ctx.workspace.id, { type: "user", id: ctx.user.id }),
    loadAffiliateSettings(service, ctx.workspace.id),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const view = myLinksView(
    products,
    code,
    today,
    publicBaseUrl(ctx.workspace as never),
  );
  const sold = refs.sales.filter((s) => s.status !== "cancelled");
  const pending = refs.commissions
    .filter((c) => !c.expense_id)
    .reduce((acc, c) => acc + toCents(Number(c.amount)), 0);
  const nameMode = settings.settings.show_lead_names;

  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/mis-links" />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 md:px-8">
          <p className="text-sm text-muted-foreground">
            Compartí estos links: quien entre por ellos queda como tu referido.
            {code ? (
              <>
                {" "}
                Tu código es{" "}
                <span className="font-mono font-medium text-foreground">
                  {code}
                </span>
                .
              </>
            ) : (
              " Todavía no pudimos crear tu código: probá de nuevo en un rato."
            )}
          </p>

          <section
            className="grid gap-3 sm:grid-cols-3"
            aria-label="Tus números"
          >
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">
                Referidos vigentes
              </p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {refs.leads.length}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Ventas</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {sold.length}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">
                Comisiones por cobrar
              </p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {usd(pending)}
              </p>
            </div>
          </section>

          <section className="space-y-3" aria-label="Links para compartir">
            <h2 className="text-sm font-semibold text-foreground">
              Links para compartir
            </h2>
            {view.length === 0 ? (
              <EmptyHint>
                Todavía no hay links activos. Cuando el equipo cargue los links
                de un producto, aparecen acá.
              </EmptyHint>
            ) : (
              view.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-border bg-card"
                >
                  <h3 className="border-b border-border px-4 py-2.5 text-sm font-medium text-foreground">
                    {p.name}
                  </h3>
                  <ul className="divide-y divide-border">
                    {p.links.map((l) => (
                      <li
                        key={l.key}
                        className="flex flex-wrap items-center gap-2 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground">
                            {l.name}
                            {l.primary && (
                              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-ink">
                                {l.primary === "learn"
                                  ? "Para conocer"
                                  : "Para convertir"}
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {l.kindLabel}
                          </p>
                        </div>
                        {l.withCode && (
                          <CopyLinkButton
                            url={l.withCode}
                            label="Copiar con mi código"
                          />
                        )}
                        <CopyLinkButton url={l.url} label="Copiar sin código" />
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>

          <section className="space-y-3" aria-label="Tus referidos">
            <h2 className="text-sm font-semibold text-foreground">
              Tus referidos
            </h2>
            {refs.leads.length === 0 ? (
              <EmptyHint>
                Todavía no tenés referidos. Aparecen acá cuando alguien entra
                por uno de tus links.
              </EmptyHint>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {refs.leads.slice(0, 50).map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
                  >
                    <span className="text-foreground">
                      {leadDisplayName(l.display_name, nameMode)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {l.affiliate_kind === "originated"
                        ? "Lo trajiste"
                        : "Influiste"}
                      {l.affiliate_expires_at
                        ? ` · hasta el ${l.affiliate_expires_at.slice(0, 10)}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
