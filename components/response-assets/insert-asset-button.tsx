"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BookmarkPlus } from "lucide-react";
import { listAssets } from "@/lib/actions/response-assets";
import {
  insertAtCursor,
  insertableText,
  isInsertableKind,
} from "@/lib/response-assets/insert";
import { ASSET_KIND_LABEL, isAssetKind } from "@/lib/response-assets/kind";

/**
 * "Insertar recurso": mete un texto o un enlace de la banca en el campo de
 * texto de una automatizacion (el email o el mensaje de un flujo), donde esta
 * el cursor.
 *
 * Solo ofrece los dos tipos que SON texto (`insertableText`); un audio, un
 * video, una imagen o un archivo se mandan con el paso "Enviar recurso", no
 * metidos en un texto. Lo insertado trae sus variables ({{contact.display_name}}
 * ...): se resuelven al enviar, con los datos del contacto de ese momento.
 *
 * El campo lo maneja quien lo usa (`value`/`onChange`); esto solo lo lee por su
 * `targetId` para saber donde esta el cursor, y lo deja justo despues de lo
 * insertado.
 */

interface Option {
  id: string;
  label: string;
  snippet: string;
}

export function InsertAssetButton({
  targetId,
  value,
  onChange,
  disabled = false,
}: {
  targetId: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // La banca se lee la primera vez que se abre, no al pintar el editor.
  useEffect(() => {
    if (!open || options !== null) return;
    let alive = true;
    listAssets()
      .then((rows) => {
        if (!alive) return;
        const found: Option[] = [];
        for (const r of rows) {
          if (!r.is_active || !isAssetKind(r.kind) || !isInsertableKind(r.kind))
            continue;
          const snippet = insertableText({
            kind: r.kind,
            content: r.content,
            url: r.url,
          });
          if (snippet)
            found.push({
              id: r.id,
              label: `${ASSET_KIND_LABEL[r.kind]} · ${r.name}`,
              snippet,
            });
        }
        setOptions(found);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [open, options]);

  // Cerrar al hacer clic afuera o con Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function insert(snippet: string) {
    const field = document.getElementById(targetId) as
      HTMLTextAreaElement | HTMLInputElement | null;
    const result = insertAtCursor(
      value,
      field?.selectionStart,
      field?.selectionEnd,
      snippet,
    );
    onChange(result.value);
    setOpen(false);
    // Despues del render, el cursor queda justo despues de lo insertado.
    requestAnimationFrame(() => {
      const el = document.getElementById(targetId) as
        HTMLTextAreaElement | HTMLInputElement | null;
      if (!el) return;
      el.focus();
      el.setSelectionRange(result.caret, result.caret);
    });
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
      >
        <BookmarkPlus className="h-3.5 w-3.5" aria-hidden /> Insertar recurso
      </button>
      {open && (
        <div
          id={menuId}
          role="listbox"
          aria-label="Recursos de la banca"
          className="absolute left-0 z-20 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {failed && (
            <p className="px-2 py-2 text-xs text-red-600">
              No pude leer la banca. Probá de nuevo en un rato.
            </p>
          )}
          {!failed && options === null && (
            <p className="px-2 py-2 text-xs text-muted-foreground">Cargando…</p>
          )}
          {options?.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              No hay textos ni enlaces activos en la banca. Cargalos en Ajustes
              → Recursos.
            </p>
          )}
          {options?.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => insert(o.snippet)}
              className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              title={o.snippet}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
