"use client";
// @plantilla-quitar(ventas)

import { useState, useTransition } from "react";
import { saveAffiliateSettings } from "@/lib/actions/affiliates";
import { resolveAffiliateSettings, type AffiliateSettings, type ReplaceRule } from "@/lib/affiliates/assign";
import { LEAD_NAME_LABELS, REPLACE_LABELS, validateAffiliateSettings } from "@/lib/affiliates/settings";
import { fieldInput } from "@/components/content/dialog";

/**
 * Afiliados › Reglas (F72): cuánto dura una asignación y qué pasa si entra otro afiliado. Valida con la gemela antes
 * de mandar; la base vuelve a validar y guarda con revisión (dos pestañas no se pisan).
 */
export function AffiliateSettingsForm({ initial, rev: initialRev, canEdit }: { initial: AffiliateSettings; rev: number; canEdit: boolean }) {
  const r = resolveAffiliateSettings(initial);
  const [lifetime, setLifetime] = useState(r.originatedMonths === null);
  const [months, setMonths] = useState(String(r.originatedMonths ?? 12));
  const [originatedReplace, setOriginatedReplace] = useState<ReplaceRule>(r.originatedReplace);
  const [days, setDays] = useState(String(r.influencedDays));
  const [renew, setRenew] = useState(r.renewOnClick);
  const [influencedReplace, setInfluencedReplace] = useState<ReplaceRule>(r.influencedReplace);
  const [firstOnly, setFirstOnly] = useState(r.firstPurchaseOnly);
  const [names, setNames] = useState(initial.show_lead_names ?? "first_name_initial");
  const [rev, setRev] = useState(initialRev);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function build(): AffiliateSettings {
    return {
      v: 1,
      originated: { months: lifetime ? null : Number(months), replace: originatedReplace },
      influenced: { days: Number(days), renew_on_click: renew, replace: influencedReplace },
      counts: { first_purchase_only: firstOnly },
      show_lead_names: names,
    };
  }

  function save() {
    const next = build();
    const problems = validateAffiliateSettings(next);
    if (problems.length) return setMsg({ kind: "error", text: problems.join(". ") });
    setMsg(null);
    start(async () => {
      const res = await saveAffiliateSettings(next, rev);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      if (res.data.status === "ok") {
        setRev(res.data.rev);
        setMsg({ kind: "ok", text: "Guardado." });
      } else if (res.data.status === "conflict") {
        setRev(res.data.rev);
        setMsg({ kind: "error", text: "Alguien cambió las reglas mientras las editabas. Recargá la página para ver lo último." });
      } else {
        setMsg({ kind: "error", text: res.data.problems.join(". ") });
      }
    });
  }

  const replaceSelect = (value: ReplaceRule, onChange: (v: ReplaceRule) => void, id: string) => (
    <select id={id} className={fieldInput} value={value} disabled={!canEdit} onChange={(e) => onChange(e.target.value as ReplaceRule)}>
      {Object.entries(REPLACE_LABELS).map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  );

  return (
    <div className="max-w-2xl space-y-6">
      <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">Cuando el afiliado trajo al contacto</legend>
        <p className="text-xs text-muted-foreground">Es el primer contacto de la persona con el negocio y entró por su link.</p>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={lifetime} disabled={!canEdit} onChange={(e) => setLifetime(e.target.checked)} />
          Es suyo de por vida
        </label>
        {!lifetime && (
          <label className="block text-sm text-foreground">
            Dura (meses)
            <input type="number" min={1} max={120} className={fieldInput} value={months} disabled={!canEdit} onChange={(e) => setMonths(e.target.value)} />
          </label>
        )}
        <label className="block text-sm text-foreground" htmlFor="aff-orig-replace">
          Si entra por el link de otro afiliado
        </label>
        {replaceSelect(originatedReplace, setOriginatedReplace, "aff-orig-replace")}
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">Cuando el afiliado influyó</legend>
        <p className="text-xs text-muted-foreground">La persona ya conocía al negocio y después entró por su link.</p>
        <label className="block text-sm text-foreground">
          Dura (días)
          <input type="number" min={1} max={3650} className={fieldInput} value={days} disabled={!canEdit} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={renew} disabled={!canEdit} onChange={(e) => setRenew(e.target.checked)} />
          Un clic nuevo en su link corre la fecha
        </label>
        <label className="block text-sm text-foreground" htmlFor="aff-infl-replace">
          Si entra por el link de otro afiliado
        </label>
        {replaceSelect(influencedReplace, setInfluencedReplace, "aff-infl-replace")}
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">Ventas y referidos</legend>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={firstOnly} disabled={!canEdit} onChange={(e) => setFirstOnly(e.target.checked)} />
          Cuenta solo la primera compra de cada referido
        </label>
        <label className="block text-sm text-foreground" htmlFor="aff-names">
          Cómo ve un afiliado el nombre de sus referidos
        </label>
        <select id="aff-names" className={fieldInput} value={names} disabled={!canEdit} onChange={(e) => setNames(e.target.value as typeof names)}>
          {Object.entries(LEAD_NAME_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </fieldset>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {pending ? "Guardando…" : "Guardar reglas"}
          </button>
          {msg && (
            <p role="status" className={msg.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
              {msg.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
