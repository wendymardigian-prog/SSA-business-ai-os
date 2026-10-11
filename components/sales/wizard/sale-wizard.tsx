"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { createSale, getSaleContactContext, type SaleContactContext } from "@/lib/actions/sales";
import { SaleModal } from "@/components/sales/sale-modal";
import { Step1Contact, DuplicateSaleWarning, type Step1Values } from "./step1-contact";
import { Step2Product, discountState, selectedVariant, type Step2Values } from "./step2-product";
import { Step3Financing } from "./step3-financing";
import type { WizardConfig, WizardInitial } from "./types";
import { activeSalesOfProduct, validateStep1 } from "@/lib/sales/wizard/step1";
import { checkRows, defaultStep3, paymentsForServer, planFromState, type Step3State } from "@/lib/sales/wizard/step3";
import { buildSummary } from "@/lib/sales/wizard/summary";
import type { PlannedPayment } from "@/lib/sales/payment-plan";
import type { WizardVariant } from "@/lib/sales/wizard/catalog";
import { DEFAULT_ATTRIBUTION_STATE } from "@/lib/sales/attribution-field";
import { formatMoney } from "@/lib/sales/format";

const STEPS = ["Contacto", "Producto y precio", "Financiamiento"] as const;

/**
 * «Nueva venta»: tres pasos. El borrador vive acá, en el navegador: no se escribe nada hasta
 * «Guardar venta» (`createSale`, que vuelve a validar todo en el servidor y relee el catálogo).
 */
export function SaleWizard({ config, initial, onClose }: { config: WizardConfig; initial?: WizardInitial; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [s1, setS1] = useState<Step1Values>({
    contact: initial?.contact ?? null,
    setterId: !config.hasAllScope ? config.currentUserId : null,
    vendedorId: initial?.vendedorId ?? null,
    attribution: DEFAULT_ATTRIBUTION_STATE,
    saleDate: config.today,
    notes: "",
    bookingId: initial?.bookingId ?? null,
  });
  const [ctx, setCtx] = useState<{ id: string; data: SaleContactContext | null } | null>(null);
  const [s2, setS2] = useState<Step2Values>({ productId: "", variantId: "", discountType: "amount", discountValue: "", discountReason: "", serviceStartsAt: "" });
  const [s3, setS3] = useState<Step3State>(() => defaultStep3(config.today));
  const [rows, setRows] = useState<PlannedPayment[]>([]);
  const [rowsFor, setRowsFor] = useState<string | null>(null);
  const [duplicateOk, setDuplicateOk] = useState(false);

  // El contexto del contacto (toques, avisos, agendas) se pide al elegirlo. Lo cargado se compara
  // con el contacto actual: así nada se setea de forma síncrona dentro del efecto.
  const contactId = s1.contact?.id ?? null;
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!contactId || requested.current === contactId) return;
    requested.current = contactId;
    let cancelled = false;
    getSaleContactContext(contactId).then((data) => {
      if (cancelled) return;
      setCtx({ id: contactId, data });
      if (data) {
        // Setter y vendedor precargados con los del contacto (si la persona no los tocó).
        setS1((prev) => (prev.contact?.id === contactId
          ? { ...prev, setterId: prev.setterId ?? data.setterId, vendedorId: prev.vendedorId ?? data.vendedorId }
          : prev));
      }
    });
    return () => { cancelled = true; };
  }, [contactId]);
  const contactContext = ctx && ctx.id === contactId ? ctx.data : null;
  const loadingContext = !!contactId && (!ctx || ctx.id !== contactId);

  const validation1 = validateStep1(
    { contactId, setterId: s1.setterId, vendedorId: s1.vendedorId, attribution: s1.attribution, saleDate: s1.saleDate, notes: s1.notes, bookingId: s1.bookingId },
    { today: config.today, touchCount: contactContext?.touchCount ?? 0, doNotContact: contactContext?.doNotContact ?? false, overduePayments: contactContext?.overduePayments ?? 0 },
  );
  const scopeError = !config.hasAllScope && s1.setterId !== config.currentUserId && s1.vendedorId !== config.currentUserId;

  const { product, variant } = selectedVariant(config.catalog, s2);
  const base = variant?.price ?? 0;
  const discount = variant ? discountState(config, base, s2) : null;
  const finalAmount = discount?.ok ? discount.finalAmount : 0;
  const duplicates = activeSalesOfProduct(contactContext?.sales ?? [], product?.id ?? null);
  const step2Ok = !!variant?.versionId && !!discount?.ok && finalAmount > 0 && (duplicates.length === 0 || duplicateOk);

  const check = useMemo(() => checkRows(rows, { saleDate: s1.saleDate, today: config.today, enabledMethods: config.enabledMethods }), [rows, s1.saleDate, config.today, config.enabledMethods]);
  const summary = useMemo(
    () => buildSummary({ financing: s3.financing, finalAmount, payments: rows, todayLocal: config.today, matchingFlows: [] }),
    [s3.financing, finalAmount, rows, config.today],
  );
  const step3Ok = summary.canSave && check.errors.length === 0 && rows.length > 0;

  function regenerate(state: Step3State, final = finalAmount) {
    setRows(planFromState(final, state));
    setRowsFor(`${final}|${state.financing}`);
  }

  function updateStep3(patch: Partial<Step3State>, regen = false) {
    const next = { ...s3, ...patch };
    // Al cambiar el financiamiento arranca de cero (un ciclo de suscripción viene con el precio).
    if (patch.financing && patch.financing !== s3.financing) {
      const fresh = { ...defaultStep3(config.today, patch.financing), firstMethod: s3.firstMethod };
      if (patch.financing === "subscription") fresh.firstAmount = String(finalAmount);
      setS3(fresh);
      regenerate(fresh);
      return;
    }
    setS3(next);
    if (regen) regenerate(next);
  }

  function pickVariant(next: WizardVariant | null) {
    setDuplicateOk(false);
    setRowsFor(null);
    // Una variante recurrente se carga como suscripción; el resto, como pago completo (editable).
    const financing = next?.billingType === "recurring" ? "subscription" : "full";
    setS3({ ...defaultStep3(config.today, financing), firstAmount: financing === "subscription" && next?.price ? String(next.price) : "" });
  }

  function next() {
    setError(null);
    if (step === 0 && validation1.canAdvance && !scopeError) setStep(1);
    else if (step === 1 && step2Ok) {
      // Al entrar al paso 3 el plan se arma de nuevo solo si cambió el precio o el financiamiento.
      if (rowsFor !== `${finalAmount}|${s3.financing}`) {
        const state = s3.financing === "subscription" && !(Number(s3.firstAmount) > 0) ? { ...s3, firstAmount: String(finalAmount) } : s3;
        setS3(state);
        regenerate(state);
      }
      setStep(2);
    }
  }

  function save() {
    if (!s1.contact || !variant?.versionId || !step3Ok) return;
    setError(null);
    start(async () => {
      const raw = Number(s2.discountValue);
      const result = await createSale({
        contactId: s1.contact!.id,
        versionId: variant.versionId!,
        discount: s2.discountValue.trim() && raw > 0 ? { type: s2.discountType, value: raw } : null,
        discountReason: s2.discountReason.trim() || null,
        financing: s3.financing,
        subscriptionInterval: s3.financing === "subscription" ? s3.subscriptionInterval : null,
        saleDate: s1.saleDate,
        setterId: s1.setterId,
        vendedorId: s1.vendedorId,
        attribution: s1.attribution as never,
        bookingId: s1.bookingId,
        serviceStartsAt: s2.serviceStartsAt || rows[0]?.due_date || null,
        notes: s1.notes.trim() || null,
        payments: paymentsForServer(rows) as never,
      });
      if (result.ok) {
        onClose();
        router.push(`/dashboard/ventas/${result.id}`);
        return;
      }
      if (result.code === "version_changed") {
        setError(`El precio de este producto cambió${result.newPrice != null ? ` a ${formatMoney(result.newPrice)}` : ""} mientras cargabas la venta. Volvé al paso 2 para revisarlo.`);
        router.refresh();
        setStep(1);
        return;
      }
      setError(result.error);
    });
  }

  const blocked = step === 0 ? !validation1.canAdvance || scopeError : step === 1 ? !step2Ok : !step3Ok;

  return (
    <SaleModal
      size="lg"
      title="Nueva venta"
      label="Nueva venta"
      onClose={onClose}
      header={
        <ol className="mt-2 flex items-center gap-2 text-xs" aria-label="Pasos">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={i === step ? "step" : undefined} className={`flex items-center gap-1.5 ${i === step ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${i < step ? "border-primary bg-primary text-primary-foreground" : i === step ? "border-primary text-primary" : "border-border"}`}>
                {i < step ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-border" aria-hidden />}
            </li>
          ))}
        </ol>
      }
      footer={
        <>
          {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
          <div className="ml-auto flex gap-2">
            {step > 0 ? (
              <button type="button" onClick={() => setStep(step - 1)} disabled={pending} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">Atrás</button>
            ) : (
              <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
            )}
            {step < 2 ? (
              <button type="button" onClick={next} disabled={blocked} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">Siguiente</button>
            ) : (
              <button type="button" onClick={save} disabled={blocked || pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Guardar venta
              </button>
            )}
          </div>
        </>
      }
    >
      {step === 0 && (
        <>
          <Step1Contact
            config={config}
            values={s1}
            onChange={(patch) => setS1((prev) => ({ ...prev, ...patch }))}
            onContact={(c) => {
              requested.current = null;
              setS1((prev) => ({ ...prev, contact: c, attribution: DEFAULT_ATTRIBUTION_STATE, bookingId: null }));
            }}
            contactContext={contactContext}
            loadingContext={loadingContext}
            validation={validation1}
            lockedContact={!!initial?.contact}
          />
          {scopeError && <p role="alert" className="text-xs text-red-700 dark:text-red-400">Elegí a alguien como setter o vendedor: tenés que ser vos, si no, no podrías ver esta venta.</p>}
        </>
      )}
      {step === 1 && (
        <>
          <DuplicateSaleWarning sales={duplicates} confirmed={duplicateOk} onConfirm={setDuplicateOk} />
          <Step2Product config={config} values={s2} onChange={(patch) => setS2((prev) => ({ ...prev, ...patch }))} onVariant={pickVariant} />
        </>
      )}
      {step === 2 && (
        <Step3Financing
          config={config}
          finalAmount={finalAmount}
          state={s3}
          onState={updateStep3}
          rows={rows}
          onRows={setRows}
          summary={summary}
          check={check}
        />
      )}
    </SaleModal>
  );
}
