"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Check, ChevronDown, ChevronUp, Copy, Sparkles } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { MetaLinkPicker, pickedIds } from "@/components/attribution/meta-link-picker";
import {
  applyMetaRule,
  applyMetaRules,
  deleteMetaMatchRule,
  ignoreTouchesMeta,
  linkTouchesToMeta,
  unlinkTouchesMeta,
  type MetaRuleInput,
} from "@/lib/actions/meta-match";
import { proposeMetaMatchesWithAi, type AiMatchSuggestion } from "@/lib/actions/meta-match-ai";
import { META_URL_PARAMS, UNLINKED_DAYS, type UnlinkedGroup, type UnlinkedView } from "@/lib/attribution/unlinked-view";
import type { UnlinkedPage } from "@/lib/attribution/unlinked-load";

/**
 * «Sin vincular»: los grupos (toques con los mismos UTMs) y sus acciones. Lo que se muestra lo arma
 * `lib/attribution/unlinked-view.ts`; esto solo lo compone y llama a las Server Actions (que vuelven a chequear
 * permiso y workspace). Vincular un grupo con UTMs crea una REGLA: vale para todos los toques con esos UTMs,
 * los de antes y los que lleguen.
 */

type Message = { tone: "ok" | "error"; text: string };
type Result = { ok: true; applied?: number } | { ok: false; error: string };

const TABS: Array<[UnlinkedView, string, keyof UnlinkedPage["counts"]]> = [
  ["sin-vincular", "Sin vincular", "unmatched"],
  ["revisar", "Para revisar", "review"],
  ["sin-anuncio", "Sin anuncio", "noAd"],
  ["reglas", "Reglas", "rules"],
  ["manuales", "Hechos a mano", "manual"],
];

const CONFIDENCE = { high: "Confianza alta", medium: "Confianza media", low: "Confianza baja" } as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ruleOf = (group: UnlinkedGroup): Omit<MetaRuleInput, "action" | "origin"> => ({
  utmCampaign: group.rule?.utmCampaign ?? null,
  utmContent: group.rule?.utmContent ?? null,
  utmTerm: group.rule?.utmTerm ?? null,
});

export function UnlinkedList({ data, view, days, canManage }: { data: UnlinkedPage; view: UnlinkedView; days: number; canManage: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [linking, setLinking] = useState<UnlinkedGroup | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [help, setHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ai, setAi] = useState<{ suggestions: AiMatchSuggestion[]; analyzed: number } | null>(null);

  const go = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) (v === null ? sp.delete(k) : sp.set(k, v));
    router.push(`${pathname}?${sp.toString()}`);
  };

  const act = (fn: () => Promise<Result>, ok: (applied: number) => string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      setMessage(result.ok ? { tone: "ok", text: ok(result.applied ?? 0) } : { tone: "error", text: result.error });
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });

  const linkedText = (applied: number) =>
    applied > 0 ? `Listo: quedó guardado como regla y se ${applied === 1 ? "vinculó 1 toque" : `vincularon ${applied} toques`}. Lo que llegue igual se vincula solo.` : "Listo: quedó guardado como regla. Lo que llegue igual se vincula solo.";

  const ignore = (group: UnlinkedGroup) =>
    group.rule
      ? act(() => applyMetaRule({ ...ruleOf(group), action: "ignore", origin: "manual" }), () => "Listo: esos UTMs no se van a vincular con ningún anuncio, tampoco los que lleguen.")
      : act(() => ignoreTouchesMeta(group.touchIds), (n) => `Listo: ${plural(n, "toque ignorado", "toques ignorados")}.`);

  const confirm = (group: UnlinkedGroup) =>
    group.linkedIds &&
    act(() => applyMetaRule({ ...ruleOf(group), action: "link", ...group.linkedIds, origin: "confirmed" }), linkedText);

  const confirmAllReview = () => {
    const inputs = data.groups
      .filter((g) => g.rule && g.linkedIds)
      .map((g) => ({ ...ruleOf(g), action: "link" as const, adId: g.linkedIds!.adId, adsetId: g.linkedIds!.adsetId, campaignId: g.linkedIds!.campaignId, origin: "confirmed" as const }));
    if (inputs.length === 0) return;
    if (!window.confirm(`Se van a guardar ${plural(inputs.length, "regla", "reglas")} con lo que se vinculó por parecido. ¿Seguimos?`)) return;
    act(
      async () => {
        const r = await applyMetaRules(inputs);
        return r.ok ? { ok: true, applied: r.saved } : r;
      },
      (n) => `Listo: ${plural(n, "regla guardada", "reglas guardadas")}.`,
    );
  };

  const proposeWithAi = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await proposeMetaMatchesWithAi({ days });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setAi({ suggestions: result.suggestions, analyzed: result.analyzed });
      if (result.suggestions.length === 0) setMessage({ tone: "ok", text: `La IA miró ${plural(result.analyzed, "grupo", "grupos")} y no encontró ninguno que pudiera proponer con seguridad.` });
    });

  const suggestionInput = (s: AiMatchSuggestion): MetaRuleInput =>
    s.level === "not_ad"
      ? { ...s.rule, action: "ignore", origin: "ai" }
      : { ...s.rule, action: "link", adId: s.adId, adsetId: s.adsetId, campaignId: s.campaignId, origin: "ai" };

  const dropSuggestion = (key: string) => setAi((prev) => (prev ? { ...prev, suggestions: prev.suggestions.filter((s) => s.key !== key) } : prev));

  const confirmAllAi = () => {
    if (!ai || ai.suggestions.length === 0) return;
    if (!window.confirm(`Se van a guardar ${plural(ai.suggestions.length, "regla", "reglas")} con lo que propuso la IA. ¿Seguimos?`)) return;
    act(
      async () => {
        const r = await applyMetaRules(ai.suggestions.map(suggestionInput));
        return r.ok ? { ok: true, applied: r.saved } : r;
      },
      (n) => `Listo: ${plural(n, "propuesta confirmada", "propuestas confirmadas")}.`,
      () => setAi(null),
    );
  };

  const copyParams = async () => {
    try {
      await navigator.clipboard.writeText(META_URL_PARAMS);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ tone: "error", text: "No pude copiar. Seleccioná el texto y copialo a mano." });
    }
  };

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const btn = "h-8 rounded-lg px-3 text-xs font-medium disabled:opacity-60";
  const primary = `${btn} bg-primary text-primary-foreground hover:opacity-90`;
  const secondary = `${btn} border border-border hover:bg-accent`;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Vista" className="inline-flex flex-wrap rounded-lg border border-border p-0.5 text-xs">
          {TABS.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => go({ vista: key === "sin-vincular" ? null : key, pagina: null })}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${view === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label} · {data.counts[count]}
            </button>
          ))}
        </div>
        {view !== "reglas" && (
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            Período
            <select
              value={days}
              onChange={(e) => go({ dias: e.target.value === "90" ? null : e.target.value, pagina: null })}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground"
            >
              {UNLINKED_DAYS.map((d) => (
                <option key={d} value={d}>
                  Últimos {d} días
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <button type="button" onClick={() => setHelp((v) => !v)} aria-expanded={help} className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium">
          Cómo evitar que pase: que cada anuncio mande su id
          {help ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
        {help && (
          <div className="space-y-2 border-t border-border p-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              Lo que llega acá son visitas cuyos parámetros de URL traen etiquetas escritas a mano (por ejemplo «ad-n4-techo») en vez de los ids del anuncio. En cada anuncio de Meta, en <strong className="text-foreground">Parámetros de URL</strong>, pegá esto:
            </p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-muted p-2 font-mono text-[11px] text-foreground">{META_URL_PARAMS}</code>
              <button type="button" onClick={copyParams} className={secondary} aria-label="Copiar los parámetros">
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              </button>
            </div>
            <p>Meta reemplaza cada {"{{…}}"} por el valor real, así cada visita se vincula sola con su campaña, conjunto y anuncio, sin reglas ni revisión.</p>
          </div>
        )}
      </div>

      {view === "sin-vincular" && canManage && (data.counts.unmatched > 0 || data.counts.noAd > 0) && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            La IA puede mirar los grupos que las reglas no resolvieron, compararlos con tu catálogo y con lo que ya está vinculado, y proponerte a qué anuncio va cada uno. No vincula nada sola: vos confirmás.
          </p>
          <button type="button" onClick={proposeWithAi} disabled={pending} className={`${primary} inline-flex items-center gap-1.5`}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {pending && !ai ? "Analizando…" : "Proponer con IA"}
          </button>
        </div>
      )}

      {message && (
        <p role="status" className={`rounded-lg border p-3 text-sm ${message.tone === "error" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-emerald-500/30 bg-emerald-500/5"}`}>
          {message.text}
        </p>
      )}

      {ai && ai.suggestions.length > 0 && (
        <section aria-label="Propuestas de la IA" className="space-y-2 rounded-lg border border-primary-edge/40 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex-1 text-sm font-medium">
              La IA propone {plural(ai.suggestions.length, "vínculo", "vínculos")} (miró {plural(ai.analyzed, "grupo", "grupos")})
            </h2>
            <button type="button" onClick={confirmAllAi} disabled={pending} className={primary}>
              Confirmar todas
            </button>
            <button type="button" onClick={() => setAi(null)} disabled={pending} className={secondary}>
              Descartar
            </button>
          </div>
          <ul className="space-y-2">
            {ai.suggestions.map((s) => (
              <li key={s.key} className="rounded-lg border border-border bg-card p-3">
                <Values values={s.values} />
                <p className="mt-2 text-sm">
                  → <span className="font-medium">{s.target}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {CONFIDENCE[s.confidence]} · {plural(s.people, "persona", "personas")}
                  {s.why ? ` · ${s.why}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    className={primary}
                    onClick={() => act(() => applyMetaRule(suggestionInput(s)), s.level === "not_ad" ? () => "Listo: esos UTMs no se van a vincular con ningún anuncio." : linkedText, () => dropSuggestion(s.key))}
                  >
                    Confirmar
                  </button>
                  <button type="button" disabled={pending} className={secondary} onClick={() => dropSuggestion(s.key)}>
                    Descartar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "revisar" && canManage && data.groups.some((g) => g.rule && g.linkedIds) && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {/* @plantilla-desde(ventas) */}
            Estos ya cuentan en Anuncios, agendas y ventas: se vincularon solos porque el nombre se parece. Confirmalos para que queden como regla, o cambiá el que no corresponda.
            {/* @plantilla-hasta(ventas) */}
            {/* @plantilla-sin(ventas): Estos ya cuentan en Anuncios y agendas: se vincularon solos porque el nombre se parece. Confirmalos para que queden como regla, o cambiá el que no corresponda. */}
          </p>
          <button type="button" onClick={confirmAllReview} disabled={pending} className={primary}>
            Confirmar todos los de esta página
          </button>
        </div>
      )}

      {data.truncated && (
        <p className="text-xs text-muted-foreground">Se muestran los grupos de los {data.touches} toques más recientes del período.</p>
      )}

      {view === "reglas" ? (
        data.rules.length === 0 ? (
          <Empty>Todavía no hay reglas. Se crean solas cuando vinculás un grupo, confirmás uno que se vinculó por parecido o aceptás una propuesta de la IA.</Empty>
        ) : (
          <ul className="space-y-2">
            {data.rules.map((rule) => (
              <li key={rule.id} className="rounded-lg border border-border bg-card p-3">
                <Values values={rule.values} />
                <p className="mt-2 text-sm">
                  → <span className="font-medium">{rule.target}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {rule.origin} · {rule.when} · {plural(rule.touches, "toque la usa", "toques la usan")}
                </p>
                {canManage && (
                  <button
                    type="button"
                    disabled={pending}
                    className={`${secondary} mt-2`}
                    onClick={() => {
                      if (!window.confirm("Al borrar la regla, sus toques se vuelven a vincular solos (pueden volver a «Sin vincular»). ¿Seguimos?")) return;
                      act(() => deleteMetaMatchRule(rule.id), (n) => `Listo: regla borrada. ${plural(n, "toque se volvió", "toques se volvieron")} a vincular solos.`);
                    }}
                  >
                    Borrar la regla
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      ) : data.groups.length === 0 ? (
        <Empty>
          {view === "sin-vincular"
            ? `No hay nada sin vincular en los últimos ${days} días. Cada visita que llega de un anuncio queda asociada sola a su campaña; lo que no se puede aparece acá.`
            : view === "revisar"
              ? `No hay nada para revisar en los últimos ${days} días.`
              : view === "sin-anuncio"
                ? `En los últimos ${days} días, todo lo vinculado tiene su anuncio.`
                : `Todavía no vinculaste ni ignoraste nada a mano en los últimos ${days} días.`}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {data.groups.map((group) => (
            <li key={group.key} className="rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium">
                  {plural(group.peopleCount, "persona", "personas")}
                  <span className="font-normal text-muted-foreground"> · {plural(group.touchIds.length, "toque", "toques")}</span>
                </span>
                {/* @plantilla-desde(ventas) */}
                {group.withSale > 0 && <Badge tone="strong">{plural(group.withSale, "con venta", "con venta")}</Badge>}
                {/* @plantilla-hasta(ventas) */}
                {group.withBooking > 0 && <Badge tone="strong">{plural(group.withBooking, "con agenda", "con agenda")}</Badge>}
                {group.firstCount > 0 && <Badge>{`Primer toque de ${group.firstCount}`}</Badge>}
                {group.lastCount > 0 && <Badge>{`Último toque de ${group.lastCount}`}</Badge>}
                {group.status === "manual" && <Badge tone="strong">Vinculado a mano</Badge>}
                {group.status === "ignored" && <Badge>Ignorado</Badge>}
              </div>

              <Values values={group.values} />

              {group.reasons.map((reason) => (
                <p key={reason} className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {reason}
                </p>
              ))}
              {group.linked && (
                <p className="mt-2 text-sm">
                  → <span className="font-medium">{group.linked}</span>
                  {group.method && <span className="text-xs text-muted-foreground"> ({group.method})</span>}
                </p>
              )}

              {canManage && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {view === "revisar" ? (
                    <>
                      {group.rule && group.linkedIds && (
                        <button type="button" onClick={() => confirm(group)} disabled={pending} className={primary}>
                          Confirmar
                        </button>
                      )}
                      <button type="button" onClick={() => setLinking(group)} disabled={pending} className={secondary}>
                        Cambiar
                      </button>
                      <button type="button" onClick={() => ignore(group)} disabled={pending} className={secondary}>
                        No es un anuncio
                      </button>
                    </>
                  ) : view === "manuales" ? (
                    <button
                      type="button"
                      onClick={() => act(() => unlinkTouchesMeta(group.touchIds), () => "Listo, esos toques vuelven a vincularse solos.")}
                      disabled={pending}
                      className={secondary}
                    >
                      {group.status === "ignored" ? "Dejar de ignorar" : "Quitar vínculo manual"}
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => setLinking(group)} disabled={pending} className={primary}>
                        {view === "sin-anuncio" ? "Elegir el anuncio" : group.touchIds.length > 1 ? "Vincular todos" : "Vincular"}
                      </button>
                      {view === "sin-vincular" && (
                        <button type="button" onClick={() => ignore(group)} disabled={pending} className={secondary}>
                          No es un anuncio
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => setOpen((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                aria-expanded={!!open[group.key]}
                className="mt-3 inline-flex items-center gap-1 text-xs text-primary-ink underline-offset-2 hover:underline"
              >
                {open[group.key] ? "Ocultar personas" : `Ver ${plural(group.peopleCount, "persona", "personas")}`}
              </button>
              {open[group.key] && (
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {group.people.map((p) => (
                    <li key={p.touchId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                      <Link href={`/dashboard/contacts/${p.contactId}`} className="font-medium underline-offset-2 hover:underline">
                        {p.contactName}
                      </Link>
                      <span className="text-muted-foreground">
                        {p.when} · {p.origin}
                      </span>
                      {/* @plantilla-desde(ventas) */}
                      {p.hasSale && <Badge tone="strong">Venta</Badge>}
                      {/* @plantilla-hasta(ventas) */}
                      {p.hasBooking && <Badge tone="strong">Agenda</Badge>}
                      {p.isFirstTouch && <Badge>Primer toque</Badge>}
                      {p.isLastTouch && <Badge>Último toque</Badge>}
                      {p.sourceHref && (
                        <Link href={p.sourceHref} className="text-primary-ink underline-offset-2 hover:underline">
                          {p.sourceLabel}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {view !== "reglas" && pages > 1 && (
        <nav aria-label="Paginas" className="flex items-center justify-between text-xs text-muted-foreground">
          <button type="button" disabled={data.page <= 1} onClick={() => go({ pagina: data.page - 1 > 1 ? String(data.page - 1) : null })} className="h-8 rounded-lg border border-border px-3 hover:bg-accent disabled:opacity-50">
            Anterior
          </button>
          <span>
            Página {data.page} de {pages}
          </span>
          <button type="button" disabled={data.page >= pages} onClick={() => go({ pagina: String(data.page + 1) })} className="h-8 rounded-lg border border-border px-3 hover:bg-accent disabled:opacity-50">
            Siguiente
          </button>
        </nav>
      )}

      {linking && (
        <Sheet title={linking.rule ? "Vincular estos UTMs con un anuncio" : "Vincular con un anuncio"} onClose={() => setLinking(null)}>
          <MetaLinkPicker
            initialQuery={linking.search}
            subtitle={
              linking.rule
                ? `${plural(linking.peopleCount, "persona", "personas")}. Queda como regla: lo que llegue con estos mismos UTMs se vincula solo.`
                : `${plural(linking.touchIds.length, "toque", "toques")} sin UTMs: se vinculan uno por uno.`
            }
            onPick={(option) => {
              const target = linking;
              setLinking(null);
              act(
                () =>
                  target.rule
                    ? applyMetaRule({ ...ruleOf(target), action: "link", ...pickedIds(option), origin: "manual" })
                    : linkTouchesToMeta({ touchIds: target.touchIds, ...pickedIds(option) }),
                target.rule ? linkedText : (n) => `Listo: ${plural(n, "toque vinculado", "toques vinculados")}.`,
              );
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

function Values({ values }: { values: Array<{ label: string; value: string }> }) {
  if (values.length === 0) return null;
  return (
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {values.map((v) => (
        <div key={v.label} className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-muted-foreground">{v.label}</dt>
          <dd className="min-w-0 break-all font-mono">{v.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "strong" }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone === "strong" ? "bg-primary/10 text-primary-ink" : "bg-muted text-muted-foreground"}`}>{children}</span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</div>;
}
