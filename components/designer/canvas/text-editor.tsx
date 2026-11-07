"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { insertVariable, parseText, serializeText } from "@/lib/designer/screens/variables";
import { cursorIn, placeCursor, readField, renderNodesInto } from "./text-dom";

export interface TextEditorHandle {
  /** «{ } Insertar variable»: la pone en el cursor (dentro de un chip, después de él). */
  insertVariable: (key: string) => void;
}

/**
 * Escribir en un texto del lienzo (F18, F24): un campo editable con los chips de variables como piezas que no se editan.
 * El contenido se arma a mano (nunca con HTML en texto); lo que se escribe vuelve como el texto guardado
 * (`{{contact.first_name}}`). Esc o hacer clic afuera salen de escribir.
 */
export function TextEditor({
  text,
  labelFor,
  onChange,
  onExit,
  onChipTap,
  handleRef,
}: {
  text: string;
  labelFor: (key: string) => string;
  onChange: (text: string) => void;
  onExit: () => void;
  /** Se tocó un chip: su posición entre los nodos del campo y su rectángulo en pantalla. */
  onChipTap: (nodeIndex: number, rect: DOMRect) => void;
  handleRef?: Ref<TextEditorHandle>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // El contenido se arma UNA vez al empezar a escribir: después lo maneja el navegador.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    renderNodesInto(root, parseText(text), labelFor);
    root.focus();
    placeCursor(root, root.childNodes.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  useImperativeHandle(handleRef, () => ({
    insertVariable(key: string) {
      const root = ref.current;
      if (!root) return;
      root.normalize();
      const { nodes } = readField(root);
      const result = insertVariable(nodes, cursorIn(root), key);
      renderNodesInto(root, result.nodes, labelFor);
      root.focus();
      placeCursor(root, result.cursor.index);
      onChange(serializeText(result.nodes));
    },
  }));

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-multiline="true"
      aria-label="Texto del diseño"
      className="min-h-[1em] cursor-text outline-none"
      onInput={() => ref.current && onChange(readField(ref.current).text)}
      onKeyDown={(event) => {
        // Las teclas son del texto: el editor no las usa como atajos (salvo Esc).
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onExit();
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !ref.current?.contains(next)) onExit();
      }}
      onPaste={(event) => {
        // Se pega solo texto: nada de formato ni de HTML de otro lado.
        event.preventDefault();
        const pasted = event.clipboardData.getData("text/plain");
        const selection = window.getSelection();
        if (!pasted || !selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(pasted);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        if (ref.current) onChange(readField(ref.current).text);
      }}
      onClick={(event) => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-var]");
        const root = ref.current;
        if (!chip || !root) return;
        root.normalize();
        const index = Array.prototype.indexOf.call(root.childNodes, chip) as number;
        onChipTap(index, chip.getBoundingClientRect());
      }}
    />
  );
}
