"use client";
// @plantilla-quitar(ventas)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { makeContactAffiliate, searchContactsForAffiliate } from "@/lib/actions/affiliates";
import { SearchPicker } from "@/components/sales/search-picker";

/**
 * «+ Agregar afiliado» (F71): el botón principal de la barra de Afiliados. Abre una ventanita donde se elige un
 * contacto, que recibe su código (no cambia nunca). Mismo patrón que «+ Agregar programa» del Portal.
 */
export function AddExternalAffiliate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function close() {
    setOpen(false);
    setPicked(null);
    setMsg(null);
  }

  function confirm() {
    if (!picked) return;
    start(async () => {
      const res = await makeContactAffiliate(picked.id);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      setMsg({ kind: "ok", text: `Listo: el código de ${picked.name} es ${res.data}.` });
      setPicked(null);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Agregar afiliado"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Agregar afiliado</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Agregar afiliado"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !pending) close();
          }}
        >
          <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-background p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">Agregar afiliado</h3>
            <p className="text-xs text-muted-foreground">
              Elegí un contacto de afuera del equipo: recibe su código y puede compartir los links de los productos. Cada persona del equipo ya tiene el suyo en «Mis links».
            </p>
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
            {msg && (
              <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                {msg.text}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={pending} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
                {msg?.kind === "ok" ? "Cerrar" : "Cancelar"}
              </button>
              <button type="button" onClick={confirm} disabled={!picked || pending} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {pending ? "Creando…" : "Crear su código"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
