"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { useAsyncSearch } from "@/components/sales/use-async-search";
import { loadSalePaymentsForCommissionTest, searchSalesForCommissionTest } from "@/lib/actions/commission-rules-lookup";
import { previewCommissions } from "@/lib/actions/commission-rules";
import type { PreviewResult } from "@/lib/commissions/action-types";
import type { DescribeLookups } from "@/lib/commissions/describe";
import type { RulesScreenData } from "@/lib/commissions/list-load";
import { formatUsd } from "@/lib/finance/format";
import { commissionRuleFromRow } from "@/lib/commissions/rule-row";
import type { SalePaymentOption, SaleTestOption } from "@/lib/commissions/rules-ui-lookup-types";
import { factsSummary, previewRoleView } from "@/lib/commissions/rules-ui-explain";
import { buildPreviewRequest, paymentOptionLabel, saleOptionDetail, saleOptionLabel, type TestTarget } from "@/lib/commissions/rules-ui-tester";
import type { CommissionRule } from "@/lib/commissions/types";
import { cn } from "@/lib/utils";
import { FOCUS, btnPrimary, inputClass } from "./ui";

/**
 * «Probar con una venta» (F58): qué comisiones generaría un cobro con las reglas de hoy, y con la regla que se está
 * editando (sin guardar) si viene una. NO ESCRIBE NADA. Se elige una venta, un pago suyo (o un cobro hipotético de
 * USD X con un método) y se ve, por cada rol activo, la regla que gana, la persona, la base, el monto y por qué las
 * reglas de arriba se quedaron afuera.
 */
export interface DraftRuleForTest {
  /** Lo que se manda a `previewCommissions` en `draftRules`. */
  payload: Record<string, unknown>;
  /** Si la regla guardada está pausada, se la prueba igual (como si estuviera activa). */
  pausedNote: boolean;
}

type PaymentsState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; payments: SalePaymentOption[] };

export function RuleTester({
  editor,
  lookups,
  savedRules,
  draftRule,
}: {
  editor: RulesScreenData["editor"];
  lookups: DescribeLookups;
  /** Las reglas guardadas de todos los roles (para decir por qué una no matcheó). */
  savedRules: CommissionRule[];
  draftRule?: DraftRuleForTest | null;
}) {
  const uid = useId();
  const search = useAsyncSearch(searchSalesForCommissionTest);
  const [recent, setRecent] = useState<{ loading: boolean; list: SaleTestOption[] }>({ loading: true, list: [] });
  const [sale, setSale] = useState<SaleTestOption | null>(null);
  const [payments, setPayments] = useState<PaymentsState>({ status: "idle" });
  const [targetKey, setTargetKey] = useState<string>("");
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState("");
  const [result, setResult] = useState<Extract<PreviewResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    searchSalesForCommissionTest("")
      .then((list) => alive && setRecent({ loading: false, list }))
      .catch(() => alive && setRecent({ loading: false, list: [] }));
    return () => {
      alive = false;
    };
  }, []);

  const methodNames = useMemo(() => Object.fromEntries(editor.methods.map((m) => [m.key, m.name])), [editor.methods]);
  const showingTyped = search.query.trim().length >= 2;
  const options = showingTyped ? search.options : recent.list;

  function pickSale(option: SaleTestOption) {
    setSale(option);
    setResult(null);
    setError(null);
    setPayments({ status: "loading" });
    search.reset();
    void loadSalePaymentsForCommissionTest(option.id)
      .then((r) => {
        if (!r.ok) return setPayments({ status: "error", message: r.error });
        setPayments({ status: "ready", payments: r.payments });
        const firstPaid = r.payments.find((p) => p.status === "paid");
        setTargetKey(firstPaid ? `payment:${firstPaid.id}` : "hypothetical");
      })
      .catch(() => setPayments({ status: "error", message: "No pude leer los pagos de esa venta" }));
  }

  function clearSale() {
    setSale(null);
    setPayments({ status: "idle" });
    setTargetKey("");
    setResult(null);
    setError(null);
  }

  function run() {
    if (pending) return;
    const target: TestTarget | null = targetKey.startsWith("payment:")
      ? { kind: "payment", paymentId: targetKey.slice("payment:".length) }
      : targetKey === "hypothetical"
        ? { kind: "hypothetical", amountText, method }
        : null;
    const request = buildPreviewRequest(sale?.id ?? null, target, draftRule?.payload ?? null);
    if (!request.ok) {
      setError(request.error);
      return;
    }
    setError(null);
    start(async () => {
      const outcome = await previewCommissions(request.input);
      if (!outcome.ok) {
        setResult(null);
        setError(outcome.error);
        return;
      }
      setResult(outcome);
    });
  }

  const rulesById = useMemo(() => {
    const map = new Map(savedRules.map((r) => [r.id, r]));
    if (draftRule) {
      const draft = commissionRuleFromRow(draftRule.payload);
      map.set(draft.id, draft);
    }
    return map;
  }, [savedRules, draftRule]);

  const views = result ? result.roles.map((r) => previewRoleView(r, rulesById, result.facts, lookups)) : [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Elegí una venta y un pago para ver qué comisiones generaría con las reglas de ahora
        {draftRule ? ", incluida la regla que estás editando (todavía sin guardar)" : ""}. <strong className="font-medium text-foreground">No se guarda nada.</strong>
      </p>
      {draftRule?.pausedNote && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Esta regla está pausada. Para la prueba la tratamos como si estuviera activa.</p>}

      <section aria-labelledby={`${uid}-sale`} className="space-y-2">
        <h3 id={`${uid}-sale`} className="text-sm font-semibold">1. La venta</h3>
        {sale ? (
          <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">{saleOptionLabel(sale)}</p>
              <p className="text-xs text-muted-foreground">{saleOptionDetail(sale)}</p>
            </div>
            <button type="button" onClick={clearSale} aria-label="Cambiar de venta" className={cn("rounded p-1 text-muted-foreground hover:bg-accent", FOCUS)}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Buscá por nombre, correo o teléfono del cliente</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input value={search.query} onChange={(e) => search.setQuery(e.target.value)} autoComplete="off" placeholder="Ej.: Pedro" className={`${inputClass} pl-8`} />
                {search.searching && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
              </span>
            </label>
            {!showingTyped && <p className="text-[11px] text-muted-foreground">{recent.loading ? "Buscando tus ventas más recientes…" : recent.list.length > 0 ? "Las ventas más recientes:" : "Todavía no hay ventas para probar."}</p>}
            {options.length > 0 && (
              <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border" aria-label="Ventas">
                {options.map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => pickSale(o)} className={cn("flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent", FOCUS)}>
                      <span className="break-words font-medium">{saleOptionLabel(o)}</span>
                      <span className="text-xs text-muted-foreground">{saleOptionDetail(o)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showingTyped && !search.searching && options.length === 0 && <p className="text-xs text-muted-foreground">No encontré ventas con eso.</p>}
          </>
        )}
      </section>

      {sale && (
        <section aria-labelledby={`${uid}-pay`} className="space-y-2">
          <h3 id={`${uid}-pay`} className="text-sm font-semibold">2. El cobro</h3>
          {payments.status === "loading" && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Leyendo los pagos…</p>}
          {payments.status === "error" && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{payments.message}</p>}
          {payments.status === "ready" && (
            <fieldset className="space-y-1.5">
              <legend className="sr-only">Cobro a probar</legend>
              {payments.payments.map((p) => (
                <label key={p.id} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", targetKey === `payment:${p.id}` ? "border-primary bg-primary/10" : "border-border")}>
                  <input type="radio" name={`${uid}-target`} checked={targetKey === `payment:${p.id}`} onChange={() => setTargetKey(`payment:${p.id}`)} className="mt-1" />
                  <span className="min-w-0 break-words">{paymentOptionLabel(p, methodNames)}</span>
                </label>
              ))}
              <label className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", targetKey === "hypothetical" ? "border-primary bg-primary/10" : "border-border")}>
                <input type="radio" name={`${uid}-target`} checked={targetKey === "hypothetical"} onChange={() => setTargetKey("hypothetical")} className="mt-1" />
                <span className="min-w-0">Un cobro hipotético<span className="block text-xs text-muted-foreground">Un monto y un método a elección; cuenta como el próximo pago de la venta.</span></span>
              </label>
              {targetKey === "hypothetical" && (
                <div className="grid gap-2 pl-6 sm:grid-cols-2">
                  <label className="space-y-1 text-xs font-medium">
                    Monto cobrado (USD)
                    <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" placeholder="Ej.: 250" className={`${inputClass} font-normal`} />
                  </label>
                  <label className="space-y-1 text-xs font-medium">
                    Método de pago
                    <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${inputClass} font-normal`}>
                      <option value="">Sin método</option>
                      {editor.methods.filter((m) => m.active).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </fieldset>
          )}
        </section>
      )}

      {sale && payments.status === "ready" && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={run} disabled={pending || !targetKey} className={btnPrimary}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {pending ? "Probando…" : "Probar"}
          </button>
          {error && <p role="alert" className="min-w-0 flex-1 text-xs text-red-700 dark:text-red-400">{error}</p>}
        </div>
      )}
      {(!sale || payments.status !== "ready") && error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}

      <div role="status" aria-live="polite" aria-busy={pending}>
        {result && (
          <section aria-label="Resultado de la prueba" className="space-y-3">
            <h3 className="text-sm font-semibold">Resultado</h3>
            <p className="text-xs text-muted-foreground">
              {result.source === "hypothetical" ? "Cobro hipotético: " : "Cobro: "}
              {factsSummary(result.facts, lookups)}
            </p>
            <ul className="space-y-2">
              {views.map((v) => (
                <li key={v.key} className={cn("rounded-xl border p-3", v.tone === "pays" ? "border-green-500/40 bg-green-500/5" : v.tone === "warn" ? "border-amber-500/40 bg-amber-500/5" : "border-border")}>
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {v.tone === "pays" && <Check className="h-3.5 w-3.5 text-green-700 dark:text-green-300" aria-hidden />}
                    {v.roleName}
                  </p>
                  <p className="mt-0.5 break-words text-sm font-medium">{v.headline}</p>
                  {v.detail && <p className="mt-0.5 break-words text-xs text-muted-foreground">{v.detail}{v.draft ? " · regla sin guardar" : ""}</p>}
                  {v.skipped.length > 0 && (
                    <div className="mt-2 border-t border-border pt-2">
                      <p className="text-[11px] font-medium text-muted-foreground">Reglas de más arriba que no aplicaron:</p>
                      <ul className="mt-1 space-y-1">
                        {v.skipped.map((s) => (
                          <li key={s.id} className="break-words text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{s.title}:</span> {s.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-sm">
              Total que se generaría: <strong className="tabular-nums">{formatUsd(result.totalCents)}</strong>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
