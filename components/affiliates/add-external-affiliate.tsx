"use client";
// @plantilla-quitar(ventas)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { makeContactAffiliate, searchContactsForAffiliate } from "@/lib/actions/affiliates";
import { SearchPicker } from "@/components/sales/search-picker";
import { ContentDialog } from "@/components/content/dialog";

/**
 * Dar de alta un afiliado externo (F71): un contacto recibe su código, que no cambia nunca. Es el botón «+ Afiliado» de
 * la barra superior, que abre el alta en un modal.
 */
export function AddExternalAffiliate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function close() {
    setOpen(false);
    setPicked(null);
    setMsg(null);
    setDone(false);
  }

  function confirm() {
    if (!picked) return;
    start(async () => {
      const res = await makeContactAffiliate(picked.id);
      if (!res.ok) return setMsg(res.error.message);
      setMsg(`Listo: el código de ${picked.name} es ${res.data}.`);
      setDone(true);
      setPicked(null);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Sumar un afiliado externo"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        <Plus className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Afiliado</span>
      </button>
      {open && (
        <ContentDialog
          title="Sumar un afiliado externo"
          label="Sumar un afiliado externo"
          onClose={close}
          footer={
            <>
              <button type="button" onClick={close} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                {done ? "Cerrar" : "Cancelar"}
              </button>
              {!done && (
                <button
                  type="button"
                  onClick={confirm}
                  disabled={!picked || pending}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  Crear su código
                </button>
              )}
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Elegí un contacto: recibe su código y puede compartir los links de los productos.</p>
            {!done && (
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
            )}
            {msg && (
              <p role="status" className="text-sm text-foreground">
                {msg}
              </p>
            )}
          </div>
        </ContentDialog>
      )}
    </>
  );
}
