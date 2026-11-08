// @plantilla-quitar(servicios)
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { saveProgramSettings, saveVariantPortal } from "@/lib/actions/services";
import { validateVariantPortalSettings, type SectionRule } from "@/lib/portal-admin/settings";
import type { PortalSection } from "@/lib/services/availability";
import { portalRows, readVariantPortal, setEnabled, setIncluded, setRule } from "@/lib/services/screens/variant-portal-form";
import { ActionError } from "@/components/contacts/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SidePanel } from "@/components/tasks/overlay";

const input = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary-edge focus:outline-none focus:ring-1 focus:ring-primary-edge";
const label = "mb-1.5 block text-xs font-semibold text-foreground";

/**
 * La pestaña «Portal» de la variante (F116): el acceso, la tabla de secciones («En el programa» vale para todas las
 * variantes; el resto, solo para esta) y el drawer con la regla de cada sección (F109). Apagar el acceso o sacar una
 * sección no corta a los servicios que ya existen.
 */
export function VariantPortalPanel({
  variantId,
  productId,
  productName,
  settings,
  rev,
  programSettings,
  programRev,
  canSections,
  canRules,
}: {
  variantId: string;
  productId: string;
  productName: string;
  settings: unknown;
  rev: number;
  programSettings: unknown;
  programRev: number;
  canSections: boolean;
  canRules: boolean;
}) {
  const router = useRouter();
  const [s, setS] = useState(() => readVariantPortal(settings));
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<PortalSection | null>(null);
  const [programToggle, setProgramToggle] = useState<{ section: PortalSection; on: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const rows = portalRows(s, programSettings);
  const problems = validateVariantPortalSettings(s);
  const change = (next: typeof s) => {
    setS(next);
    setDirty(true);
    setSaved(false);
  };

  function save() {
    setError(null);
    start(async () => {
      const res = await saveVariantPortal(variantId, s, rev);
      if (!res.ok) return setError(res.error.message);
      if (res.data.status === "conflict") return setError("Alguien cambió el portal de esta variante. Recargá la página para ver lo último.");
      if (res.data.status === "invalid") return setError((res.data.problems ?? []).join(" · "));
      setDirty(false);
      setSaved(true);
      router.refresh();
    });
  }

  function saveProgram(section: PortalSection, on: boolean) {
    setError(null);
    start(async () => {
      const prev = (programSettings && typeof programSettings === "object" ? (programSettings as { sections?: Record<string, boolean> }).sections : undefined) ?? {};
      const res = await saveProgramSettings(productId, { sections: { ...prev, [section]: on } }, programRev);
      if (!res.ok) return setError(res.error.message);
      if (res.data.status === "conflict") return setError("Alguien cambió el programa. Recargá la página para ver lo último.");
      if (res.data.status === "invalid") return setError((res.data.problems ?? []).join(" · "));
      router.refresh();
    });
  }

  const rule = open ? s.sections?.find((r) => r.section === open) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={s.enabled === true} disabled={!canSections} onChange={(e) => change(setEnabled(s, e.target.checked))} />
          Acceso al portal
        </label>
        <Link href="/dashboard/portal" className="text-xs text-primary-ink underline-offset-2 hover:underline">
          Editar el contenido en Portal › programa
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        Apagar el acceso o sacar una sección vale para los servicios nuevos; los que ya existen se cambian en su ficha. El acceso se corta cuando termina el servicio,
        cuando vence su regla o por mora (si está configurado en la pestaña Servicio).
      </p>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Sección</th>
              <th className="px-3 py-2 font-medium">En el programa</th>
              <th className="px-3 py-2 font-medium">Incluida en esta variante</th>
              <th className="px-3 py-2 font-medium">Se abre</th>
              <th className="px-3 py-2 font-medium">Hasta</th>
              <th className="px-3 py-2 font-medium">Límites</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.section} className="border-t border-border">
                <td className="px-3 py-2">
                  <button type="button" disabled={!canRules || !r.included} onClick={() => setOpen(r.section)} className="font-medium text-foreground hover:underline disabled:no-underline">
                    {r.label}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`${r.label} en el programa`}
                    checked={r.inProgram}
                    disabled={!canSections || pending}
                    onChange={(e) => setProgramToggle({ section: r.section, on: e.target.checked })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input type="checkbox" aria-label={`${r.label} incluida en esta variante`} checked={r.included} disabled={!canSections} onChange={(e) => change(setIncluded(s, r.section, e.target.checked))} />
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.opensLabel}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.untilLabel}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.limitsLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {problems.length > 0 && (
        <ul role="alert" className="list-disc space-y-0.5 rounded-lg border border-border bg-muted/40 px-6 py-3 text-xs">
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
          disabled={pending || !dirty || problems.length > 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          Guardar el portal
        </button>
        {saved && <span className="text-xs text-good">Guardado.</span>}
      </div>

      {open && <RuleDrawer section={open} label={rows.find((r) => r.section === open)?.label ?? open} rule={rule} onChange={(patch) => change(setRule(s, open, patch))} onClose={() => setOpen(null)} />}
      <ConfirmDialog
        open={!!programToggle}
        title={programToggle?.on ? "Prender la sección en el programa" : "Apagar la sección en el programa"}
        message={`Vale para todas las variantes de ${productName}.${programToggle && !programToggle.on ? " Los accesos a esta sección dejan de valer para todos, sin borrarse." : ""}`}
        confirmLabel={programToggle?.on ? "Prender" : "Apagar"}
        cancelLabel="Cancelar"
        destructive={!programToggle?.on}
        onConfirm={() => {
          const t = programToggle;
          setProgramToggle(null);
          if (t) saveProgram(t.section, t.on);
        }}
        onCancel={() => setProgramToggle(null)}
      />
    </div>
  );
}

function RuleDrawer({ section, label: title, rule, onChange, onClose }: { section: PortalSection; label: string; rule: SectionRule | undefined; onChange: (patch: Partial<SectionRule>) => void; onClose: () => void }) {
  const opens = rule?.opens ?? { type: "service_start" as const };
  const until = rule?.until ?? { type: "service" as const };
  return (
    <SidePanel
      label={`Regla de ${title}`}
      onClose={onClose}
      header={<p className="text-sm font-semibold">{title}: cuándo se abre y hasta cuándo</p>}
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
            Listo
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <div>
          <label htmlFor="rule-opens" className={label}>
            Se abre
          </label>
          <select id="rule-opens" value={opens.type} onChange={(e) => onChange({ opens: { type: e.target.value as NonNullable<SectionRule["opens"]>["type"] } })} className={input}>
            <option value="service_start">Al empezar el servicio</option>
            <option value="days_after_start">N días después del inicio</option>
            <option value="fixed_date">En una fecha</option>
            <option value="challenge_started">Al empezar el Reto</option>
            <option value="journey_item">Lo abre un paso del camino</option>
            <option value="automation">Lo abre una automatización</option>
          </select>
          {opens.type === "days_after_start" && (
            <input aria-label="Días después del inicio" inputMode="numeric" value={opens.days ?? ""} onChange={(e) => onChange({ opens: { ...opens, days: e.target.value ? Number(e.target.value) : null } })} className={`${input} mt-2`} />
          )}
          {opens.type === "fixed_date" && <input aria-label="Fecha en que se abre" type="date" value={opens.date ?? ""} onChange={(e) => onChange({ opens: { ...opens, date: e.target.value || null } })} className={`${input} mt-2`} />}
        </div>
        <div>
          <label htmlFor="rule-until" className={label}>
            Hasta
          </label>
          <select id="rule-until" value={until.type} onChange={(e) => onChange({ until: { type: e.target.value as NonNullable<SectionRule["until"]>["type"] } })} className={input}>
            <option value="service">Lo que dure el servicio</option>
            <option value="days">N días</option>
            <option value="months">N meses</option>
            <option value="fixed_date">Una fecha</option>
            <option value="forever">Para siempre</option>
          </select>
          {(until.type === "days" || until.type === "months") && (
            <input aria-label="Cuánto dura" inputMode="numeric" value={until.n ?? ""} onChange={(e) => onChange({ until: { ...until, n: e.target.value ? Number(e.target.value) : null } })} className={`${input} mt-2`} />
          )}
          {until.type === "fixed_date" && <input aria-label="Fecha en que termina" type="date" value={until.date ?? ""} onChange={(e) => onChange({ until: { ...until, date: e.target.value || null } })} className={`${input} mt-2`} />}
        </div>
        <div>
          <label htmlFor="rule-display" className={label}>
            Mientras está cerrada
          </label>
          <select id="rule-display" value={rule?.display ?? "locked"} onChange={(e) => onChange({ display: e.target.value as SectionRule["display"] })} className={input}>
            <option value="locked">Se ve con un candado</option>
            <option value="coming_soon">Se ve como «Próximamente»</option>
            <option value="hidden">No se ve</option>
          </select>
        </div>
        {section === "community" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rule?.limits?.community_can_post !== false} onChange={(e) => onChange({ limits: { community_can_post: e.target.checked } })} />
            Puede publicar en la comunidad
          </label>
        )}
        {section === "assistant" && (
          <div>
            <label htmlFor="rule-ai" className={label}>
              Límite de gasto de IA por mes (USD)
            </label>
            <input id="rule-ai" inputMode="decimal" placeholder="El del programa" value={rule?.ai_limit_usd ?? ""} onChange={(e) => onChange({ ai_limit_usd: e.target.value ? Number(e.target.value) : undefined })} className={input} />
          </div>
        )}
      </div>
    </SidePanel>
  );
}
