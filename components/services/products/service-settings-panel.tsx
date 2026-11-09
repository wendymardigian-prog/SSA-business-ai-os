// @plantilla-quitar(servicios)
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { saveServiceSettings } from "@/lib/actions/services";
import { validateServiceSettings, type ServiceMode, type WhenRule } from "@/lib/services/settings";
import { MODE_LABELS, WHEN_RULE_LABELS, serviceSettingsForm, toServiceSettings, type ServiceSettingsForm } from "@/lib/services/screens/service-settings-form";
import { ActionError } from "@/components/contacts/ui";

const input = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary-edge focus:outline-none focus:ring-1 focus:ring-primary-edge";
const label = "mb-1.5 block text-xs font-semibold text-foreground";
const hint = "mt-1 text-[11px] text-muted-foreground";

export interface NamedOption {
  id: string;
  name: string;
}

/**
 * La pestaña «Servicio» de la variante (F31, F115). «Al cobrarse esta variante»: Crea un servicio · Extiende el que ya
 * tiene · No crea servicio. Se guarda con versión: si alguien cambió algo mientras tanto, la base responde
 * «conflict» y se pide recargar. La validación es la gemela de la base.
 */
export function ServiceSettingsPanel({
  variantId,
  productId,
  settings,
  rev,
  members,
  siblings,
}: {
  variantId: string;
  productId: string;
  settings: unknown;
  rev: number;
  members: NamedOption[];
  /** Las otras variantes del producto, con su modo. */
  siblings: Array<NamedOption & { mode: ServiceMode }>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ServiceSettingsForm>(() => serviceSettingsForm(settings));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (patch: Partial<ServiceSettingsForm>) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  };

  const next = toServiceSettings(form);
  const problems = validateServiceSettings(next, {
    productId,
    variants: [{ id: variantId, productId, mode: form.mode }, ...siblings.map((s) => ({ id: s.id, productId, mode: s.mode }))],
    members: members.map((m) => m.id),
  });
  const createVariants = siblings.filter((s) => s.mode === "create");

  function save() {
    setError(null);
    start(async () => {
      const res = await saveServiceSettings(variantId, next, rev);
      if (!res.ok) return setError(res.error.message);
      if (res.data.status === "conflict") return setError("Alguien cambió esto mientras lo editabas. Recargá la página para ver lo último.");
      if (res.data.status === "invalid") return setError((res.data.problems ?? []).join(" · ") || "La configuración no es válida");
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className={label}>Al cobrarse esta variante</legend>
        <div className="flex flex-wrap gap-2">
          {(["create", "extend", "none"] as const).map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary-edge has-[:checked]:bg-primary/5">
              <input type="radio" name="svc-mode" checked={form.mode === m} onChange={() => set({ mode: m })} />
              {MODE_LABELS[m]}
            </label>
          ))}
        </div>
      </fieldset>

      {form.mode !== "none" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="svc-rule" className={label}>
              ¿Cuándo se {form.mode === "create" ? "crea el servicio" : "extiende"}?
            </label>
            <select id="svc-rule" value={form.rule} onChange={(e) => set({ rule: e.target.value as WhenRule })} className={input}>
              {(Object.keys(WHEN_RULE_LABELS) as WhenRule[]).map((r) => (
                <option key={r} value={r}>
                  {WHEN_RULE_LABELS[r]}
                </option>
              ))}
            </select>
            <p className={hint}>Vale para pagos cobrados desde ahora; las ventas anteriores se crean a mano desde Ventas.</p>
          </div>
          {(form.rule === "percent" || form.rule === "amount") && (
            <div>
              <label htmlFor="svc-rule-value" className={label}>
                {form.rule === "percent" ? "Porcentaje cobrado (1 a 100)" : "Monto cobrado (USD)"}
              </label>
              <input id="svc-rule-value" inputMode="decimal" value={form.ruleValue} onChange={(e) => set({ ruleValue: e.target.value })} className={input} />
            </div>
          )}
        </div>
      )}

      {form.mode === "create" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.confirm} onChange={(e) => set({ confirm: e.target.checked })} />
            Pedir confirmación antes de activarlo
          </label>
          <div>
            <label htmlFor="svc-start" className={label}>
              Fecha de inicio
            </label>
            <select id="svc-start" value={form.start} onChange={(e) => set({ start: e.target.value as ServiceSettingsForm["start"] })} className={input}>
              <option value="payment_date">La fecha del pago</option>
              <option value="sale_date">La fecha de la venta</option>
              <option value="manual">La elige una persona al confirmar</option>
            </select>
          </div>
          <div>
            <label htmlFor="svc-renewal" className={label}>
              Si vuelve a comprar
            </label>
            <select id="svc-renewal" value={form.renewal} onChange={(e) => set({ renewal: e.target.value as ServiceSettingsForm["renewal"] })} className={input}>
              <option value="new_linked">Servicio nuevo enlazado</option>
              <option value="extend">Extender el anterior</option>
              <option value="ask">Preguntar</option>
            </select>
          </div>
          <div>
            <label htmlFor="svc-owner-mode" className={label}>
              Responsable
            </label>
            <select id="svc-owner-mode" value={form.ownerMode} onChange={(e) => set({ ownerMode: e.target.value as ServiceSettingsForm["ownerMode"] })} className={input}>
              <option value="round_robin">Reparto entre varias personas</option>
              <option value="fixed">Siempre la misma persona</option>
              <option value="previous">La del servicio anterior</option>
              <option value="conditions">Según condiciones</option>
            </select>
          </div>
          {form.ownerMode === "fixed" && (
            <div>
              <label htmlFor="svc-owner" className={label}>
                Persona
              </label>
              <select id="svc-owner" value={form.ownerUserId} onChange={(e) => set({ ownerUserId: e.target.value })} className={input}>
                <option value="">Elegí…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(form.ownerMode === "round_robin" || form.ownerMode === "conditions") && (
            <fieldset className="sm:col-span-2">
              <legend className={label}>Personas del reparto</legend>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs">
                    <input
                      type="checkbox"
                      checked={form.ownerMembers.includes(m.id)}
                      onChange={(e) => set({ ownerMembers: e.target.checked ? [...form.ownerMembers, m.id] : form.ownerMembers.filter((x) => x !== m.id) })}
                    />
                    {m.name}
                  </label>
                ))}
              </div>
              {form.ownerMode === "conditions" && <p className={hint}>Las condiciones se arman igual que en la asignación de leads. Las que no se cumplen pasan al reparto.</p>}
            </fieldset>
          )}
          <div>
            <label htmlFor="svc-fallback" className={label}>
              Persona de respaldo
            </label>
            <select id="svc-fallback" value={form.fallbackUserId} onChange={(e) => set({ fallbackUserId: e.target.value })} className={input}>
              <option value="">Elegí…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className={hint}>Si nadie del reparto puede tomarlo, queda a su nombre.</p>
          </div>
        </div>
      )}

      {form.mode === "extend" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="sm:col-span-2">
            <legend className={label}>Qué servicio extiende</legend>
            <label className="mr-4 inline-flex items-center gap-2 text-sm">
              <input type="radio" name="svc-ext-any" checked={form.extendAnyVariant} onChange={() => set({ extendAnyVariant: true })} />
              De cualquier variante del producto
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" name="svc-ext-any" checked={!form.extendAnyVariant} onChange={() => set({ extendAnyVariant: false })} />
              De estas variantes
            </label>
            {!form.extendAnyVariant && (
              <div className="mt-2 flex flex-wrap gap-2">
                {siblings.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs">
                    <input
                      type="checkbox"
                      checked={form.extendTargets.includes(s.id)}
                      onChange={(e) => set({ extendTargets: e.target.checked ? [...form.extendTargets, s.id] : form.extendTargets.filter((x) => x !== s.id) })}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="flex gap-2">
            <div className="w-24">
              <label htmlFor="svc-ext-n" className={label}>
                Suma
              </label>
              <input id="svc-ext-n" inputMode="numeric" value={form.extendN} onChange={(e) => set({ extendN: e.target.value })} className={input} />
            </div>
            <div className="flex-1">
              <label htmlFor="svc-ext-unit" className={label}>
                &nbsp;
              </label>
              <select id="svc-ext-unit" value={form.extendUnit} onChange={(e) => set({ extendUnit: e.target.value as ServiceSettingsForm["extendUnit"] })} className={input}>
                <option value="days">días</option>
                <option value="weeks">semanas</option>
                <option value="months">meses</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.extendAccesses} onChange={(e) => set({ extendAccesses: e.target.checked })} />
            Extender también los accesos con fecha propia
          </label>
          <div>
            <label htmlFor="svc-ext-none" className={label}>
              Si no tiene un servicio para extender
            </label>
            <select id="svc-ext-none" value={form.ifNoService} onChange={(e) => set({ ifNoService: e.target.value as ServiceSettingsForm["ifNoService"] })} className={input}>
              <option value="confirm">Dejarlo por confirmar</option>
              <option value="create">Crearlo</option>
            </select>
          </div>
          <div>
            <label htmlFor="svc-ext-fallback" className={label}>
              Variante de respaldo
            </label>
            <select id="svc-ext-fallback" value={form.fallbackVariantId} onChange={(e) => set({ fallbackVariantId: e.target.value })} className={input}>
              <option value="">Elegí…</option>
              {createVariants.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className={hint}>Tiene que ser una variante de este producto que crea un servicio: se usan su configuración y su camino.</p>
          </div>
          <p className={`${hint} sm:col-span-2`}>Si la venta se cancela o se reembolsa, la extensión no se revierte sola: el aviso ofrece «Revertir la extensión».</p>
        </div>
      )}

      {form.mode !== "none" && (
        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div>
            <label htmlFor="svc-red" className={label}>
              Semáforo por pagos: días de atraso para rojo
            </label>
            <input id="svc-red" inputMode="numeric" value={form.overdueRedDays} onChange={(e) => set({ overdueRedDays: e.target.value })} placeholder="Sin regla" className={input} />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.overdueCut} onChange={(e) => set({ overdueCut: e.target.checked })} />
              Mora: cortar los accesos
            </label>
            {form.overdueCut && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input aria-label="Días de mora" inputMode="numeric" value={form.overdueCutDays} onChange={(e) => set({ overdueCutDays: e.target.value })} className={input} />
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={form.overdueRestore} onChange={(e) => set({ overdueRestore: e.target.checked })} />
                  Devolverlos al pagar
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <ul role="alert" className="list-disc space-y-0.5 rounded-lg border border-border bg-muted/40 px-6 py-3 text-xs text-foreground">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && <ActionError message={error} />}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || problems.length > 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          Guardar
        </button>
        {saved && <span className="text-xs text-good">Guardado.</span>}
      </div>
    </div>
  );
}
