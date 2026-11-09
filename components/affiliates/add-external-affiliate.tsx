"use client";
// @plantilla-quitar(ventas)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { makeContactAffiliate, searchContactsForAffiliate } from "@/lib/actions/affiliates";
import { SearchPicker } from "@/components/sales/search-picker";

/** Dar de alta un afiliado externo (F71): un contacto recibe su código, que no cambia nunca. */
export function AddExternalAffiliate() {
  const router = useRouter();
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    if (!picked) return;
    start(async () => {
      const res = await makeContactAffiliate(picked.id);
      if (!res.ok) return setMsg(res.error.message);
      setMsg(`Listo: el código de ${picked.name} es ${res.data}.`);
      setPicked(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Sumar un afiliado externo</h3>
      <p className="text-xs text-muted-foreground">Elegí un contacto: recibe su código y puede compartir los links de los productos.</p>
      <SearchPicker
        label="Contacto"
        placeholder="Buscar por nombre o email"
        search={searchContactsForAffiliate}
        getKey={(c) => c.id}
        renderOption={(c) => (
          <span>
            {c.name}
            {c.email && <span className="ml-2 text-xs text-muted-foreground">{c.email}</span>}
          </span>
        )}
        selectedLabel={picked?.name ?? null}
        onPick={(c) => setPicked({ id: c.id, name: c.name })}
        onClear={() => setPicked(null)}
        disabled={pending}
      />
      <div className="flex items-center gap-3">
        <button type="button" onClick={confirm} disabled={!picked || pending} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {pending ? "Creando…" : "Crear su código"}
        </button>
        {msg && (
          <p role="status" className="text-sm text-muted-foreground">
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
