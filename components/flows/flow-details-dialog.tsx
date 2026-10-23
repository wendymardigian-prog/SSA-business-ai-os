"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { listFlowCategories, updateFlowDetails } from "@/lib/actions/flows";
import { MAX_DESCRIPTION_LENGTH, MAX_FLOW_NAME_LENGTH } from "@/lib/flows/categories";
import { CategoryInput } from "./category-input";

export interface FlowDetails {
  name: string;
  description: string | null;
  categories: string[];
}

/**
 * Nombre, descripción y categorías de una automatización. Se guarda al instante (no pasa por "Publicar": es
 * información sobre la automatización, no lo que hace). Lo abren el lienzo ("Detalles") y la lista (menú "⋯").
 */
export function FlowDetailsDialog({
  open,
  flowId,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  flowId: string;
  initial: FlowDetails;
  onClose: () => void;
  onSaved: (details: FlowDetails) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [categories, setCategories] = useState<string[]>(initial.categories);
  const [suggestions, setSuggestions] = useState<Array<{ name: string; count: number }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial.name);
    setDescription(initial.description ?? "");
    setCategories(initial.categories);
    setError(null);
    let alive = true;
    listFlowCategories()
      .then((list) => alive && setSuggestions(list))
      .catch(() => alive && setSuggestions([]));
    return () => {
      alive = false;
    };
    // Al abrir: lo guardado. Mientras esta abierto no se pisa lo que se escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await updateFlowDetails({ flowId, name, description, categories });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved({ name: res.name ?? name, description: res.description ?? null, categories: res.categories ?? categories });
      onClose();
    } catch {
      setError("No se pudieron guardar los detalles. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-labelledby="flow-details-title">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 id="flow-details-title" className="text-base font-semibold">
            Detalles de la automatización
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <label htmlFor="fd-name" className="mb-1.5 block text-xs font-semibold">
              Nombre
            </label>
            <input id="fd-name" value={name} maxLength={MAX_FLOW_NAME_LENGTH} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label htmlFor="fd-description" className="mb-1.5 block text-xs font-semibold">
              Qué hace
            </label>
            <textarea
              id="fd-description"
              value={description}
              maxLength={MAX_DESCRIPTION_LENGTH}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Por ejemplo: le manda el link de la agenda a quien escribe «info» y lo etiqueta como interesado."
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">
              {description.length}/{MAX_DESCRIPTION_LENGTH}
            </p>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold">Categorías</p>
            <CategoryInput values={categories} onChange={setCategories} suggestions={suggestions} />
            <p className="mt-1.5 text-[11px] text-muted-foreground">Sirven para encontrarla y filtrar la lista. Podés poner varias.</p>
          </div>
          {error && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving || !name.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
