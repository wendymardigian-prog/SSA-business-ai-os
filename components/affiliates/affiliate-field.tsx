"use client";
// @plantilla-quitar(ventas)

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { searchAffiliates, setContactAffiliate, setSaleAffiliate, type AffiliateOption } from "@/lib/actions/affiliates";
import { SearchPicker } from "@/components/sales/search-picker";
import { fieldInput } from "@/components/content/dialog";
import type { AffiliateOfRecord } from "@/lib/affiliates/load";

export const KIND_LABEL = { originated: "Lo trajo", influenced: "Influyó" } as const;

/** El texto chico al lado del nombre del afiliado: tipo, vencimiento y si se asignó a mano. */
export function affiliateSummary(record: AffiliateOfRecord, target: "contact" | "sale"): string {
  const parts: string[] = [];
  if (record.kind) parts.push(KIND_LABEL[record.kind]);
  if (record.expiresAt) parts.push(`hasta el ${record.expiresAt.slice(0, 10)}`);
  else if (target === "contact" && record.kind === "originated") parts.push("de por vida");
  if (record.source === "manual") parts.push("asignado a mano");
  return parts.join(" · ");
}

export interface AffiliateEditValue {
  picked: AffiliateOption | null;
  kind: "originated" | "influenced";
  /** Solo en un contacto (AAAA-MM-DD, vacío = sin vencimiento). */
  expiresAt: string;
  reason: string;
}

export function initialAffiliateEdit(record: AffiliateOfRecord): AffiliateEditValue {
  return { picked: null, kind: record.kind ?? "influenced", expiresAt: "", reason: "" };
}

/**
 * Los campos para asignar o cambiar un afiliado (buscador, tipo, vencimiento en un contacto y motivo). Controlado: lo
 * usan el recuadro de la ficha del contacto y la ventana «Editar venta».
 */
export function AffiliateEditFields({ target, value, onChange, disabled }: { target: "contact" | "sale"; value: AffiliateEditValue; onChange: (next: AffiliateEditValue) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <SearchPicker
        label="Afiliado"
        placeholder="Buscar por nombre o código"
        search={searchAffiliates}
        getKey={(o) => `${o.type}:${o.id}`}
        renderOption={(o) => (
          <span>
            {o.name}
            <span className="ml-2 text-xs text-muted-foreground">{o.type === "user" ? "equipo" : "externo"}</span>
          </span>
        )}
        selectedLabel={value.picked?.name ?? null}
        onPick={(picked) => onChange({ ...value, picked })}
        onClear={() => onChange({ ...value, picked: null })}
        disabled={disabled}
      />
      <label className="block text-xs text-muted-foreground">
        Tipo
        <select className={fieldInput} value={value.kind} disabled={disabled} onChange={(e) => onChange({ ...value, kind: e.target.value as AffiliateEditValue["kind"] })}>
          <option value="originated">Lo trajo</option>
          <option value="influenced">Influyó</option>
        </select>
      </label>
      {target === "contact" && (
        <label className="block text-xs text-muted-foreground">
          Vence (vacío = sin vencimiento)
          <input type="date" className={fieldInput} value={value.expiresAt} disabled={disabled} onChange={(e) => onChange({ ...value, expiresAt: e.target.value })} />
        </label>
      )}
      <label className="block text-xs text-muted-foreground">
        Motivo
        <textarea className={fieldInput} rows={2} value={value.reason} disabled={disabled} onChange={(e) => onChange({ ...value, reason: e.target.value })} placeholder="Por qué se cambia" />
      </label>
      {target === "sale" && <p className="text-xs text-muted-foreground">Vale para los pagos que se cobren desde ahora; las comisiones ya generadas no cambian.</p>}
    </div>
  );
}

/** El nombre del afiliado (con link si es un contacto) y su código. */
export function AffiliateName({ affiliate }: { affiliate: NonNullable<AffiliateOfRecord["affiliate"]> }) {
  return (
    <>
      {affiliate.type === "contact" ? (
        <Link href={`/dashboard/contacts/${affiliate.id}`} className="hover:underline">
          {affiliate.name}
        </Link>
      ) : (
        affiliate.name
      )}
      {affiliate.code && <span className="ml-2 font-mono text-xs text-muted-foreground">{affiliate.code}</span>}
    </>
  );
}

/**
 * El afiliado de un contacto o de una venta (F104): quién lo trajo, de qué tipo y hasta cuándo. Con `affiliates.assign`
 * se asigna, cambia o quita, siempre con motivo (queda en el historial). En una venta, el cambio vale para los pagos que
 * se cobren desde ahora.
 */
export function AffiliateField({ target, id, record, canAssign }: { target: "contact" | "sale"; id: string; record: AffiliateOfRecord; canAssign: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<AffiliateEditValue>(() => initialAffiliateEdit(record));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(remove: boolean) {
    setError(null);
    if (!edit.reason.trim()) return setError("Escribí el motivo");
    if (!remove && !edit.picked) return setError("Elegí el afiliado");
    const ref = remove || !edit.picked ? null : { type: edit.picked.type, id: edit.picked.id };
    start(async () => {
      const res =
        target === "contact"
          ? await setContactAffiliate(id, ref, { kind: remove ? null : edit.kind, expiresAt: !remove && edit.expiresAt ? new Date(`${edit.expiresAt}T23:59:59`).toISOString() : null, reason: edit.reason })
          : await setSaleAffiliate(id, ref, { kind: remove ? null : edit.kind, reason: edit.reason });
      if (!res.ok) return setError(res.error.message);
      setEditing(false);
      setEdit({ ...edit, picked: null, reason: "" });
      router.refresh();
    });
  }

  const a = record.affiliate;
  const summary = affiliateSummary(record, target);
  return (
    <section aria-labelledby={`afiliado-${target}`} className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`afiliado-${target}`} className="text-sm font-semibold text-foreground">
          Afiliado
        </h3>
        {canAssign && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent">
            {a ? "Cambiar" : "Asignar"}
          </button>
        )}
      </div>
      {a ? (
        <p className="mt-1 text-sm text-foreground">
          <AffiliateName affiliate={a} />
          {summary && <span className="ml-2 text-xs text-muted-foreground">{summary}</span>}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Sin afiliado.</p>
      )}
      {record.ownCode && (
        <p className="mt-1 text-xs text-muted-foreground">
          Es afiliado: su código es <span className="font-mono text-foreground">{record.ownCode}</span>.
        </p>
      )}

      {editing && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <AffiliateEditFields target={target} value={edit} onChange={setEdit} disabled={pending} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => submit(false)} disabled={pending} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {pending ? "Guardando…" : "Guardar"}
            </button>
            {a && (
              <button type="button" onClick={() => submit(true)} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
                Quitar el afiliado
              </button>
            )}
            <button type="button" onClick={() => setEditing(false)} disabled={pending} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
