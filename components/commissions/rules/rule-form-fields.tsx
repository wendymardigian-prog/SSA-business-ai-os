"use client";

import { ChipMultiSelect } from "@/components/finance/chip-multi-select";
import { searchMetaForCommissionRule, searchPiecesForCommissionRule } from "@/lib/actions/commission-rules-lookup";
import type { DescribeLookups } from "@/lib/commissions/describe";
import type { RulesScreenData } from "@/lib/commissions/list-load";
import { payeeLabel } from "@/lib/commissions/roles";
import type { DraftErrors, RuleDraft, UtmDraft } from "@/lib/commissions/rules-ui-draft";
import {
  CHANNEL_GROUPS,
  FINANCING_GROUPS,
  FINANCING_OPTIONS,
  PAYMENT_TYPE_GROUPS,
  PAYMENT_TYPE_OPTIONS,
  CHANNEL_OPTIONS,
  PLATFORM_GROUPS,
  labelFrom,
  memberLabel,
  memberOptions,
  methodLabel,
  methodOptions,
  personChoices,
  platformLabel,
  productLabel,
  productOptions,
  variantGroups,
  variantLabel,
} from "@/lib/commissions/rules-ui-options";
import { UTM_DIMENSIONS, type CommissionRole, type UtmDimension } from "@/lib/commissions/types";
import { SearchAddField } from "./search-add-field";
import { TokenInput } from "./token-input";
import { Field, GroupField, Section, inputClass, inputError } from "./ui";

type Editor = RulesScreenData["editor"];

const META_ID = /^[A-Za-z0-9_-]{1,40}$/;
const UTM_LABELS: Record<UtmDimension, string> = { source: "Fuente (utm_source)", medium: "Medio (utm_medium)", campaign: "Campaña (utm_campaign)", content: "Contenido (utm_content)", term: "Término (utm_term)" };

const PERSON_DEFAULT: Record<string, string> = {
  sale_vendedor: "El vendedor de la venta",
  sale_setter: "El setter de la venta",
  content_assignee: "El responsable de la pieza",
};

export interface RuleFormFieldsProps {
  draft: RuleDraft;
  set: (patch: Partial<RuleDraft>) => void;
  errors: DraftErrors;
  role: CommissionRole;
  editor: Editor;
  lookups: DescribeLookups;
  /** Prefijo único para los `id` de los campos. */
  uid: string;
}

/** Los campos de la regla, por secciones: datos, Venta, Pago, Origen, Cálculo, a quién se le paga, retención y vigencia. */
export function RuleFormFields({ draft, set, errors, role, editor, lookups, uid }: RuleFormFieldsProps) {
  const id = (name: string) => `${uid}-${name}`;
  const setUtm = (dim: UtmDimension, patch: Partial<UtmDraft>) => set({ utm: { ...draft.utm, [dim]: { ...draft.utm[dim], ...patch } } });
  const people = personChoices(editor, draft.beneficiaryUserId);

  return (
    <div>
      <Section title="La regla">
        <Field label="Nombre" htmlFor={id("name")} error={errors.name} hint="Para reconocerla en la lista. Ej.: «Vendedor, mentoría en cuotas».">
          <input id={id("name")} value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} aria-invalid={errors.name ? true : undefined} className={`${inputClass} ${errors.name ? inputError : ""}`} autoComplete="off" />
        </Field>
        <p className="text-xs text-muted-foreground">
          Rol: <span className="font-medium text-foreground">{role.name}</span> · se le paga a {payeeLabel(role.payee).toLowerCase()}. Una regla no cambia de rol.
        </p>
      </Section>

      <Section title="Cuándo aplica" description="Dejá vacío lo que no importe: vale «cualquiera». Entre condiciones tienen que cumplirse todas; dentro de una lista alcanza con una.">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Venta</h4>
        <GroupField label="Vendedor" hint="Solo las ventas de estas personas.">
          <ChipMultiSelect label="Vendedor" groups={[{ label: "", options: memberOptions(editor) }]} selected={draft.vendedorIds} labelOf={(v) => memberLabel(editor, v)} onChange={(vendedorIds) => set({ vendedorIds })} />
        </GroupField>
        <GroupField label="Setter">
          <ChipMultiSelect label="Setter" groups={[{ label: "", options: memberOptions(editor) }]} selected={draft.setterIds} labelOf={(v) => memberLabel(editor, v)} onChange={(setterIds) => set({ setterIds })} />
        </GroupField>
        {draft.userIds.length > 0 && (
          <GroupField label={`Persona del rol (${payeeLabel(role.payee).toLowerCase()})`} hint="Una condición que ya tenía esta regla. Se puede quitar, no agregar.">
            <ChipMultiSelect label="Persona del rol" groups={[]} selected={draft.userIds} labelOf={(v) => memberLabel(editor, v)} onChange={(userIds) => set({ userIds })} />
          </GroupField>
        )}
        <GroupField label="Producto">
          <ChipMultiSelect
            label="Producto"
            groups={[{ label: "", options: productOptions(editor, draft.productIds) }]}
            selected={draft.productIds}
            labelOf={(v) => productLabel(editor, v)}
            onChange={(productIds) => set({ productIds })}
          />
        </GroupField>
        <GroupField label="Variante" hint={draft.productIds.length > 0 ? "Solo las variantes de los productos elegidos." : undefined}>
          <ChipMultiSelect
            label="Variante"
            groups={variantGroups(editor, draft.productIds, draft.variantIds)}
            selected={draft.variantIds}
            labelOf={(v) => variantLabel(editor, v)}
            onChange={(variantIds) => set({ variantIds })}
          />
        </GroupField>
        <GroupField label="Financiamiento">
          <ChipMultiSelect label="Financiamiento" groups={FINANCING_GROUPS} selected={draft.financingTypes} labelOf={(v) => labelFrom(FINANCING_OPTIONS, v)} onChange={(financingTypes) => set({ financingTypes })} />
        </GroupField>
        <GroupField label="Monto de la venta (USD)" error={errors["conditions.sale_amount"]} hint="El total de la venta, no del pago. Dejá un extremo vacío para no limitarlo.">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[11px] text-muted-foreground">
              Desde
              <input value={draft.saleAmountMin} onChange={(e) => set({ saleAmountMin: e.target.value })} inputMode="decimal" placeholder="Sin mínimo" className={`${inputClass} text-foreground ${errors["conditions.sale_amount"] ? inputError : ""}`} />
            </label>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              Hasta
              <input value={draft.saleAmountMax} onChange={(e) => set({ saleAmountMax: e.target.value })} inputMode="decimal" placeholder="Sin máximo" className={`${inputClass} text-foreground ${errors["conditions.sale_amount"] ? inputError : ""}`} />
            </label>
          </div>
        </GroupField>

        <h4 className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pago</h4>
        <GroupField label="Método de pago">
          <ChipMultiSelect label="Método de pago" groups={[{ label: "", options: methodOptions(editor, draft.paymentMethods) }]} selected={draft.paymentMethods} labelOf={(v) => methodLabel(editor, v)} onChange={(paymentMethods) => set({ paymentMethods })} />
        </GroupField>
        <GroupField label="Tipo de pago">
          <ChipMultiSelect label="Tipo de pago" groups={PAYMENT_TYPE_GROUPS} selected={draft.paymentTypes} labelOf={(v) => labelFrom(PAYMENT_TYPE_OPTIONS, v)} onChange={(paymentTypes) => set({ paymentTypes })} />
        </GroupField>
        <GroupField label="Número de pago" error={errors["conditions.payment_number"]} hint="El 1 es el primer pago de la venta. Ej.: desde 2 para que no pague el primero.">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[11px] text-muted-foreground">
              Desde el pago
              <input value={draft.paymentNumberFrom} onChange={(e) => set({ paymentNumberFrom: e.target.value })} inputMode="numeric" placeholder="Desde el primero" className={`${inputClass} text-foreground ${errors["conditions.payment_number"] ? inputError : ""}`} />
            </label>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              Hasta el pago
              <input value={draft.paymentNumberTo} onChange={(e) => set({ paymentNumberTo: e.target.value })} inputMode="numeric" placeholder="Hasta el último" className={`${inputClass} text-foreground ${errors["conditions.payment_number"] ? inputError : ""}`} />
            </label>
          </div>
        </GroupField>

        <h4 className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Origen</h4>
        <GroupField label="Canal" hint="Cómo llegó la persona que compró (la atribución de la venta).">
          <ChipMultiSelect label="Canal" groups={CHANNEL_GROUPS} selected={draft.channels} labelOf={(v) => labelFrom(CHANNEL_OPTIONS, v)} onChange={(channels) => set({ channels })} />
        </GroupField>
        <GroupField label="Red">
          <ChipMultiSelect label="Red" groups={PLATFORM_GROUPS} selected={draft.platforms} labelOf={platformLabel} onChange={(platforms) => set({ platforms })} />
        </GroupField>
        <Field label="Pieza puntual" htmlFor={id("post")} error={errors["conditions.content_post_ids"]} hint="Solo las ventas que vienen de estas piezas de contenido.">
          <SearchAddField
            id={id("post")}
            label="Pieza"
            values={draft.contentPostIds}
            onChange={(contentPostIds) => set({ contentPostIds })}
            search={async (q) => (await searchPiecesForCommissionRule(q)).map((p) => ({ id: p.id, label: p.title, hint: p.code ? `Código ${p.code}` : null }))}
            seedLabels={lookups.posts ?? {}}
            placeholder="Buscá una pieza por título o código"
            invalid={!!errors["conditions.content_post_ids"]}
          />
        </Field>
        <Field label="Campaña de Meta" htmlFor={id("campaign")} error={errors["conditions.meta_campaign_ids"]} hint="Por nombre o por id de la campaña.">
          <SearchAddField
            id={id("campaign")}
            label="Campaña de Meta"
            values={draft.metaCampaignIds}
            onChange={(metaCampaignIds) => set({ metaCampaignIds })}
            search={async (q) => (await searchMetaForCommissionRule("campaign", q)).map((c) => ({ id: c.id, label: c.name ?? c.id, hint: `Id ${c.id}` }))}
            seedLabels={lookups.metaCampaigns ?? {}}
            placeholder="Buscá una campaña o pegá su id"
            rawId={META_ID}
            invalid={!!errors["conditions.meta_campaign_ids"]}
          />
        </Field>
        <Field label="Anuncio de Meta" htmlFor={id("ad")} error={errors["conditions.meta_ad_ids"]} hint="Por nombre o por id del anuncio.">
          <SearchAddField
            id={id("ad")}
            label="Anuncio de Meta"
            values={draft.metaAdIds}
            onChange={(metaAdIds) => set({ metaAdIds })}
            search={async (q) => (await searchMetaForCommissionRule("ad", q)).map((a) => ({ id: a.id, label: a.name ?? a.id, hint: a.hint ? `Campaña ${a.hint}` : `Id ${a.id}` }))}
            seedLabels={lookups.metaAds ?? {}}
            placeholder="Buscá un anuncio o pegá su id"
            rawId={META_ID}
            invalid={!!errors["conditions.meta_ad_ids"]}
          />
        </Field>

        {UTM_DIMENSIONS.map((dim) => {
          const utm = draft.utm[dim];
          const error = errors[`conditions.utm.${dim}`];
          return (
            <GroupField key={dim} label={UTM_LABELS[dim]} error={error}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <select
                  aria-label={`${UTM_LABELS[dim]}: cómo comparar`}
                  value={utm.op}
                  onChange={(e) => setUtm(dim, { op: e.target.value === "contains" ? "contains" : "equals" })}
                  className={`${inputClass} sm:w-36 sm:shrink-0`}
                >
                  <option value="equals">es igual a</option>
                  <option value="contains">contiene</option>
                </select>
                <div className="min-w-0 flex-1">
                  <TokenInput
                    id={id(`utm-${dim}`)}
                    label={UTM_LABELS[dim].split(" (")[0]}
                    values={utm.values}
                    onChange={(values) => setUtm(dim, { values })}
                    placeholder="Escribí un valor y apretá Enter"
                    max={20}
                    maxLength={200}
                    suggestions={editor.utm[dim]}
                    invalid={!!error}
                  />
                </div>
              </div>
            </GroupField>
          );
        })}
      </Section>

      <Section title="Cuánto se paga">
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">Tipo de cálculo</legend>
          <div className="flex flex-wrap gap-2">
            {(["percent", "fixed"] as const).map((type) => (
              <label key={type} className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${draft.calcType === type ? "border-primary bg-primary/10 font-medium" : "border-border"}`}>
                <input type="radio" name={id("calc")} checked={draft.calcType === type} onChange={() => set({ calcType: type })} className="sr-only" />
                {type === "percent" ? "Un porcentaje" : "Un monto fijo"}
              </label>
            ))}
          </div>
        </fieldset>

        {draft.calcType === "percent" ? (
          <>
            <Field label="Porcentaje" htmlFor={id("rate")} error={errors.rate} hint="Hasta 3 decimales. Podés usar coma o punto.">
              <div className="relative">
                <input id={id("rate")} value={draft.rate} onChange={(e) => set({ rate: e.target.value })} inputMode="decimal" placeholder="Ej.: 12,5" aria-invalid={errors.rate ? true : undefined} className={`${inputClass} pr-8 ${errors.rate ? inputError : ""}`} />
                <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </Field>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium">Sobre qué se calcula</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  { value: "gross", title: "Cobrado", text: "Lo que pagó el cliente." },
                  { value: "net_of_fees", title: "Neto del procesador", text: "Lo cobrado menos lo que se queda el procesador de pagos." },
                ] as const).map((o) => (
                  <label key={o.value} className={`block cursor-pointer rounded-lg border p-2.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${draft.base === o.value ? "border-primary bg-primary/10" : "border-border"}`}>
                    <input type="radio" name={id("base")} checked={draft.base === o.value} onChange={() => set({ base: o.value })} className="sr-only" />
                    <span className="block font-medium">{o.title}</span>
                    <span className="block text-xs text-muted-foreground">{o.text}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        ) : (
          <Field label="Monto fijo por pago (USD)" htmlFor={id("fixed")} error={errors.fixedAmount} hint="Se paga este monto por cada pago cobrado que cumpla la regla.">
            <input id={id("fixed")} value={draft.fixedAmount} onChange={(e) => set({ fixedAmount: e.target.value })} inputMode="decimal" placeholder="Ej.: 15" aria-invalid={errors.fixedAmount ? true : undefined} className={`${inputClass} ${errors.fixedAmount ? inputError : ""}`} />
          </Field>
        )}
      </Section>

      <Section title="A quién se le paga">
        {role.payee === "fixed" ? (
          <Field label="Persona" htmlFor={id("person")} error={errors.beneficiaryUserId} hint="Este rol es de una persona fija: cada regla dice quién cobra.">
            <select id={id("person")} value={draft.beneficiaryUserId} onChange={(e) => set({ beneficiaryUserId: e.target.value })} aria-invalid={errors.beneficiaryUserId ? true : undefined} className={`${inputClass} ${errors.beneficiaryUserId ? inputError : ""}`}>
              <option value="">Elegí una persona</option>
              {people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
        ) : (
          <Field
            label="Quién cobra"
            htmlFor={id("person")}
            error={errors.beneficiaryUserId}
            hint={`Por defecto cobra ${(PERSON_DEFAULT[role.payee] ?? "la persona del rol").toLowerCase()}. Si elegís a alguien, cobra esa persona.`}
          >
            <select id={id("person")} value={draft.beneficiaryUserId} onChange={(e) => set({ beneficiaryUserId: e.target.value })} className={inputClass}>
              <option value="">{PERSON_DEFAULT[role.payee] ?? "La persona del rol"} (por defecto)</option>
              {people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
        )}
      </Section>

      <Section title="Retención y vigencia">
        <Field label="Días de retención" htmlFor={id("hold")} error={errors.holdDays} hint="La comisión queda «Retenida» esta cantidad de días desde el cobro y recién después se puede liquidar. 0 = disponible enseguida.">
          <input id={id("hold")} value={draft.holdDays} onChange={(e) => set({ holdDays: e.target.value })} inputMode="numeric" aria-invalid={errors.holdDays ? true : undefined} className={`${inputClass} sm:w-40 ${errors.holdDays ? inputError : ""}`} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vale desde (opcional)" htmlFor={id("from")} error={errors.validFrom} hint="Se mira la fecha del cobro.">
            <input id={id("from")} type="date" value={draft.validFrom} onChange={(e) => set({ validFrom: e.target.value })} className={`${inputClass} ${errors.validFrom ? inputError : ""}`} />
          </Field>
          <Field label="Vale hasta (opcional)" htmlFor={id("until")} error={errors.validUntil}>
            <input id={id("until")} type="date" value={draft.validUntil} onChange={(e) => set({ validUntil: e.target.value })} aria-invalid={errors.validUntil ? true : undefined} className={`${inputClass} ${errors.validUntil ? inputError : ""}`} />
          </Field>
        </div>
      </Section>
    </div>
  );
}
