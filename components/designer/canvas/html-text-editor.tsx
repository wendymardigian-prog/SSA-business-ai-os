"use client";

import { useEffect, useRef, type CSSProperties, type Ref } from "react";
import type { ScreenBox } from "@/lib/designer/screens/html-texts";
import { TextEditor, type TextEditorHandle } from "./text-editor";

/** La tipografía del texto original, leída del iframe, para que lo que se escribe se parezca a lo que se ve. */
export interface HtmlTextLook {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  textTransform: string;
}

/**
 * Escribir un texto de adentro de un HTML cargado (F42): el mismo campo que los textos del lienzo (`TextEditor`, con los
 * chips de variables), en una tarjeta encima del texto original. Se guarda UNA vez al salir (Esc o clic afuera): cada
 * cambio del HTML vuelve a dibujar el iframe, así que no se guarda tecla por tecla.
 */
export function HtmlTextEditor({
  text,
  box,
  look,
  inverseScale: inv,
  zIndex,
  labelFor,
  onCommit,
  onExit,
  onChipTap,
  handleRef,
}: {
  text: string;
  /** Dónde va la tarjeta, en px del diseño. */
  box: ScreenBox;
  look: HtmlTextLook | null;
  inverseScale: number;
  zIndex: number;
  labelFor: (key: string) => string;
  /** El texto escrito, solo si cambió. */
  onCommit: (text: string) => void;
  onExit: () => void;
  onChipTap: (nodeIndex: number, rect: DOMRect) => void;
  handleRef?: Ref<TextEditorHandle>;
}) {
  const draft = useRef(text);
  const done = useRef(false);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  function exit() {
    if (done.current) return;
    done.current = true;
    if (draft.current !== text) onCommit(draft.current);
    onExit();
  }

  // Si el campo desaparece sin perder el foco (se eligió otra cosa en el mismo clic), lo escrito igual se guarda.
  useEffect(() => {
    done.current = false; // en desarrollo React monta dos veces: el primer desmontaje no cuenta
    return () => {
      if (done.current) return;
      done.current = true;
      if (draft.current !== text) commitRef.current(draft.current);
    };
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al desmontar
    [],
  );

  const style: CSSProperties = {
    position: "absolute",
    left: box.left,
    top: box.top,
    minWidth: box.width,
    minHeight: box.height,
    maxWidth: "100%",
    zIndex,
    padding: `${2 * inv}px ${4 * inv}px`,
    borderRadius: 6 * inv,
    boxShadow: `0 0 0 ${2 * inv}px var(--primary-edge), 0 ${6 * inv}px ${18 * inv}px rgba(0,0,0,.25)`,
    whiteSpace: "pre-wrap",
    ...((look ?? {}) as CSSProperties),
  };

  return (
    <div className="bg-card text-foreground" style={style} onPointerDown={(event) => event.stopPropagation()}>
      <TextEditor
        text={text}
        labelFor={labelFor}
        onChange={(next) => {
          draft.current = next;
        }}
        onExit={exit}
        onChipTap={onChipTap}
        handleRef={handleRef}
      />
    </div>
  );
}
