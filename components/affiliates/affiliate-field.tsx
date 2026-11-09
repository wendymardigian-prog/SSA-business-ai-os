"use client";
// @plantilla-quitar(ventas)

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { searchAffiliates, setContactAffiliate, setSaleAffiliate, type AffiliateOption } from "@/lib/actions/affiliates";
import { SearchPicker } from "@/components/sales/search-picker";
import { fieldInput } from "@/components/content/dialog";
import type { AffiliateOfRecord } from "@/lib/affiliates/load";

const KIND_LABEL = { originated: "Lo trajo", influenced: "Influyó" } as const;

/**
 * El afiliado de un contacto o de una venta (F104): quién lo trajo, de qué tipo y hasta cuándo. Con `affiliates.assign`
 * se asigna, cambia o quita, siempre con motivo (queda en el historial). En una venta, el cambio vale para los pagos que
 * se cobren desde ahora.
 */
export function AffiliateField({ target, id, record, canAssign }: { target: "contact" | "sale"; id: string; record: AffiliateOfRecord; canAssign: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<AffiliateOption | null>(null);
  const [kind, setKind] = useState<"originated" | "influenced">(record.kind ?? "influenced");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(remove: boolean) {
    setError(null);
    if (!reason.trim()) return setError("Escribí el motivo");
    if (!remove && !picked) return setError("Elegí el afiliado");
    const ref = remove || !picked ? null : { type: picked.type, id: picked.id };
    start(async () => {
      const res =
        target === "contact"
          ? await setContactAffiliate(id, ref, { kind: remove ? null : kind, expiresAt: !remove && expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null, reason })
          : await setSaleAffiliate(id, ref, { kind: remove ? null : kind, reason });
      if (!res.ok) return setError(res.error.message);
      setEditing(false);
      setPicked(null);
      setReason("");
      router.refresh();
    });
  }

  const a = record.affiliate;
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
          {a.type === "contact" ? (
            <Link href={`/dashboard/contacts/${a.id}`} className="hover:underline">
              {a.name}
            </Link>
          ) : (
            a.name
          )}
          {a.code && <span className="ml-2 font-mono text-xs text-muted-foreground">{a.code}</span>}
          <span className="ml-2 text-xs text-muted-foreground">
            {record.kind ? KIND_LABEL[record.kind] : ""}
            {record.expiresAt ? ` · hasta el ${record.expiresAt.slice(0, 10)}` : target === "contact" && record.kind === "originated" ? " · de por vida" : ""}
            {record.source === "manual" ? " · asignado a mano" : ""}
          </span>
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
            selectedLabel={picked?.name ?? null}
            onPick={setPicked}
            onClear={() => setPicked(null)}
            disabled={pending}
          />
          <label className="block text-xs text-muted-foreground">
            Tipo
            <select className={fieldInput} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="originated">Lo trajo</option>
              <option value="influenced">Influyó</option>
            </select>
          </label>
          {target === "contact" && (
            <label className="block text-xs text-muted-foreground">
              Vence (vacío = sin vencimiento)
              <input type="date" className={fieldInput} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </label>
          )}
          <label className="block text-xs text-muted-foreground">
            Motivo
            <textarea className={fieldInput} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por qué se cambia" />
          </label>
          {target === "sale" && <p className="text-xs text-muted-foreground">Vale para los pagos que se cobren desde ahora; las comisiones ya generadas no cambian.</p>}
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
