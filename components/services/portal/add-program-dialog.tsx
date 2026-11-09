"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { addPortalProgram } from "@/lib/actions/portal-admin";
import { addProgramProblem } from "@/lib/portal-admin/programs";
import { fieldInput } from "@/components/content/dialog";

/** «+ Agregar programa» (F35): un producto sin portal y qué variantes tienen acceso (al menos una). */
export function AddProgramDialog({ products }: { products: Array<{ id: string; name: string; variants: Array<{ id: string; name: string }> }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<string>("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const product = products.find((p) => p.id === productId);

  function submit() {
    const problem = addProgramProblem(productId || null, [...picked]);
    if (problem) return setError(problem);
    setError(null);
    start(async () => {
      const res = await addPortalProgram(productId, [...picked]);
      if (!res.ok) return setError(res.error.message);
      setOpen(false);
      router.push(`/dashboard/portal/${productId}`);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={products.length === 0}
        title={products.length === 0 ? "Todos los productos activos ya tienen portal" : undefined}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        <Plus className="h-4 w-4" aria-hidden /> Agregar programa
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Agregar programa" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-background p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">Agregar programa</h3>
            <label className="block text-xs text-muted-foreground">
              Producto
              <select
                className={fieldInput}
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setPicked(new Set());
                }}
              >
                <option value="">Elegí un producto</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {product && (
              <fieldset className="space-y-1">
                <legend className="text-xs text-muted-foreground">Qué variantes tienen acceso al portal</legend>
                {product.variants.map((v) => (
                  <label key={v.id} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={picked.has(v.id)}
                      onChange={(e) =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(v.id);
                          else n.delete(v.id);
                          return n;
                        })
                      }
                    />
                    {v.name}
                  </label>
                ))}
              </fieldset>
            )}
            <p className="text-xs text-muted-foreground">Las secciones y cuándo se abre cada una se ajustan después en Productos › variante › Portal.</p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
                Cancelar
              </button>
              <button type="button" onClick={submit} disabled={pending} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {pending ? "Agregando…" : "Agregar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
