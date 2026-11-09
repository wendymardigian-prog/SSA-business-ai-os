"use client";
// @plantilla-quitar(ventas)

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveProductLinks } from "@/lib/actions/affiliates";
import { CONVERT_KINDS, LEARN_KINDS, LINK_KINDS, LINK_KIND_LABELS, newLinkKey, validateProductLinks, type LinkKind, type ProductLink, type ProductLinks } from "@/lib/affiliates/product-links";
import { fieldInput } from "@/components/content/dialog";

/**
 * La tarjeta Links del producto (F70): los links para conocerlo y para comprarlo, con los dos principales. Cada link
 * tiene una clave estable (`lk_xxxxxx`) que no cambia al renombrarlo: es la que usan los links de los afiliados. Valida
 * con la gemela antes de mandar; la base vuelve a validar y guarda con revisión. Los links no se borran una vez que
 * alguien los compartió: se desactivan (un link nuevo sin guardar sí se puede sacar).
 */
export function ProductLinksCard({
  productId,
  initial,
  rev: initialRev,
  variants,
}: {
  productId: string;
  initial: ProductLinks;
  rev: number;
  variants: Array<{ id: string; name: string }>;
}) {
  const [links, setLinks] = useState<ProductLinks>(initial);
  const [saved, setSaved] = useState<Set<string>>(() => new Set(initial.items.map((i) => i.key)));
  const [rev, setRev] = useState(initialRev);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const update = (key: string, patch: Partial<ProductLink>) => setLinks((l) => ({ ...l, items: l.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  const add = () =>
    setLinks((l) => ({
      ...l,
      items: [...l.items, { key: newLinkKey(l.items.map((i) => i.key)), name: "", kind: "landing", url: "https://", active: true, valid_until: null, variant_id: null }],
    }));
  const removeNew = (key: string) =>
    setLinks((l) => ({
      ...l,
      primary_learn: l.primary_learn === key ? null : l.primary_learn,
      primary_convert: l.primary_convert === key ? null : l.primary_convert,
      items: l.items.filter((i) => i.key !== key),
    }));

  function save() {
    const problems = validateProductLinks(links, variants.map((v) => v.id));
    if (problems.length) return setMsg({ kind: "error", text: problems.join(". ") });
    setMsg(null);
    start(async () => {
      const res = await saveProductLinks(productId, links, rev);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      const data = res.data;
      if (data.status === "ok") {
        setRev(data.rev);
        setSaved(new Set(links.items.map((i) => i.key)));
        setMsg({ kind: "ok", text: ["Guardado.", ...(data.notices ?? [])].join(" ") });
      } else if (data.status === "conflict") {
        setRev(data.rev);
        setMsg({ kind: "error", text: "Alguien cambió los links mientras los editabas. Recargá la página para ver lo último." });
      } else {
        setMsg({ kind: "error", text: data.problems.join(". ") });
      }
    });
  }

  const primaryOptions = (kinds: readonly LinkKind[]) => links.items.filter((i) => kinds.includes(i.kind) && i.active);

  return (
    <section aria-labelledby="links-title" className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 id="links-title" className="text-sm font-semibold text-foreground">
            Links
          </h3>
          <p className="text-xs text-muted-foreground">Los links para conocer y comprar este producto. El equipo y los afiliados los comparten desde «Mis links».</p>
        </div>
        <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
          <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar link
        </button>
      </div>

      {links.items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Todavía no hay links. Agregá la página del producto, una landing, la agenda o el checkout.</p>
      ) : (
        <ul className="divide-y divide-border">
          {links.items.map((l) => (
            <li key={l.key} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_10rem_1.5fr_auto]">
              <label className="text-xs text-muted-foreground">
                Nombre
                <input className={fieldInput} value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} placeholder="Landing principal" />
              </label>
              <label className="text-xs text-muted-foreground">
                Tipo
                <select className={fieldInput} value={l.kind} onChange={(e) => update(l.key, { kind: e.target.value as LinkKind })}>
                  {LINK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {LINK_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Link
                <input className={fieldInput} type="url" value={l.url} onChange={(e) => update(l.key, { url: e.target.value.trim() })} placeholder="https://" />
              </label>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-1.5 pb-2 text-xs text-foreground">
                  <input type="checkbox" checked={l.active} onChange={(e) => update(l.key, { active: e.target.checked })} /> Activo
                </label>
                {!saved.has(l.key) && (
                  <button type="button" onClick={() => removeNew(l.key)} aria-label="Sacar este link nuevo" className="mb-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              <label className="text-xs text-muted-foreground md:col-span-1">
                Vigente hasta (opcional)
                <input className={fieldInput} type="date" value={l.valid_until ?? ""} onChange={(e) => update(l.key, { valid_until: e.target.value || null })} />
              </label>
              {variants.length > 1 && (
                <label className="text-xs text-muted-foreground md:col-span-2">
                  Variante (opcional)
                  <select className={fieldInput} value={l.variant_id ?? ""} onChange={(e) => update(l.key, { variant_id: e.target.value || null })}>
                    <option value="">Todas</option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 border-t border-border px-4 py-3 md:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          Principal para conocer
          <select className={fieldInput} value={links.primary_learn ?? ""} onChange={(e) => setLinks((l) => ({ ...l, primary_learn: e.target.value || null }))}>
            <option value="">Ninguno</option>
            {primaryOptions(LEARN_KINDS).map((i) => (
              <option key={i.key} value={i.key}>
                {i.name || i.url}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Principal para convertir
          <select className={fieldInput} value={links.primary_convert ?? ""} onChange={(e) => setLinks((l) => ({ ...l, primary_convert: e.target.value || null }))}>
            <option value="">Ninguno</option>
            {primaryOptions(CONVERT_KINDS).map((i) => (
              <option key={i.key} value={i.key}>
                {i.name || i.url}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
        <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {pending ? "Guardando…" : "Guardar links"}
        </button>
        {msg && (
          <p role="status" className={msg.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
            {msg.text}
          </p>
        )}
      </div>
    </section>
  );
}
