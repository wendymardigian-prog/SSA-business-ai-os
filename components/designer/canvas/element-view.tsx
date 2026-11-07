"use client";

import { Lock } from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, Ref } from "react";
import type { DesignElement, TextElement } from "@/lib/designer/doc/schema";
import { elementStyle, textInnerStyle, toReactStyle } from "@/lib/designer/render/page-html";
import { handleStyle, handlesFor, outlineStyle, type HandleId } from "@/lib/designer/screens/canvas-session";
import { parseText } from "@/lib/designer/screens/variables";
import { CHIP_CLASS } from "./text-dom";
import { TextEditor, type TextEditorHandle } from "./text-editor";

export interface ElementViewProps {
  el: DesignElement;
  zIndex: number;
  /** Las URLs firmadas de los archivos del diseño (ruta → link). */
  assetUrls: Readonly<Record<string, string>>;
  labelFor: (key: string) => string;
  /** «Ver con datos de ejemplo»: los chips se reemplazan por estos valores. */
  values: Readonly<Record<string, string>> | null;
  selected: boolean;
  /** Es la única selección: lleva asas (y la barra del elemento). */
  sole: boolean;
  editing: boolean;
  inverseScale: number;
  readOnly: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, el: DesignElement) => void;
  onDoubleClick: (el: DesignElement) => void;
  onHandleDown: (event: ReactPointerEvent<HTMLElement>, el: DesignElement, handle: HandleId) => void;
  onTextChange: (el: TextElement, text: string) => void;
  onExitEdit: () => void;
  onChipTap: (el: TextElement, nodeIndex: number, rect: DOMRect) => void;
  textHandleRef?: Ref<TextEditorHandle>;
}

/** El contenido de un texto sin escribir: texto, chips (o su valor de ejemplo) y saltos de línea. */
function TextBody({ el, labelFor, values }: { el: TextElement; labelFor: (key: string) => string; values: ElementViewProps["values"] }) {
  const nodes = parseText(el.text);
  const inner = textInnerStyle(el);
  const content = nodes.map((node, i) => {
    if (node.kind === "br") return <br key={i} />;
    if (node.kind === "text") return node.text;
    if (values) return values[node.key] ?? labelFor(node.key);
    return (
      <span key={i} className={CHIP_CLASS} data-var={node.key} data-node={i} title={`{{${node.key}}}`}>
        {labelFor(node.key)}
      </span>
    );
  });
  const body = nodes.length === 0 ? "​" : content;
  return Object.keys(inner).length > 0 ? <span style={toReactStyle(inner) as CSSProperties}>{body}</span> : <>{body}</>;
}

/**
 * Un elemento del lienzo. Se dibuja con LAS MISMAS funciones de estilo que el render (`elementStyle`,
 * `textInnerStyle`, `toReactStyle`): lo que se ve es lo que se exporta. La única diferencia es que el recorte (`overflow`,
 * esquinas) va en un contenedor de adentro, para que las asas de la selección puedan salir del elemento.
 *
 * Los bloques de HTML cargado NO se dibujan acá: van en un `iframe` con `sandbox` (ver `canvas-stage.tsx`); acá es solo
 * la caja que se toca.
 */
export function ElementView(props: ElementViewProps) {
  const { el, selected, sole, editing, inverseScale: inv, readOnly } = props;
  const decl = elementStyle(el, props.zIndex);
  delete decl.overflow;
  const style: CSSProperties = toReactStyle(decl) as CSSProperties;
  if (el.hidden) style.opacity = 0.25;
  style.touchAction = "none";
  style.cursor = editing ? "text" : el.locked || readOnly ? "default" : "move";
  style.userSelect = editing ? "text" : "none";

  const handles = sole && !editing && !readOnly ? handlesFor(el) : [];

  return (
    <div
      data-el-id={el.id}
      data-el-type={el.type}
      style={style}
      onPointerDown={(event) => props.onPointerDown(event, el)}
      onDoubleClick={() => props.onDoubleClick(el)}
    >
      {el.type === "text" &&
        (editing ? (
          <TextEditor
            text={el.text}
            labelFor={props.labelFor}
            onChange={(text) => props.onTextChange(el, text)}
            onExit={props.onExitEdit}
            onChipTap={(index, rect) => props.onChipTap(el, index, rect)}
            handleRef={props.textHandleRef}
          />
        ) : (
          <TextBody el={el} labelFor={props.labelFor} values={props.values} />
        ))}

      {el.type === "image" && (
        <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: el.radius ? `${el.radius}px` : undefined }}>
          {props.assetUrls[el.asset] ? (
            // eslint-disable-next-line @next/next/no-img-element -- link firmado de Storage, dentro del lienzo escalado
            <img src={props.assetUrls[el.asset]} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: el.fit, display: "block" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", background: "repeating-linear-gradient(45deg, #e5e7eb 0 12px, #f3f4f6 12px 24px)" }} />
          )}
        </div>
      )}

      {selected && !editing && <span aria-hidden style={outlineStyle(inv) as CSSProperties} />}
      {selected && el.locked && !editing && (
        <span aria-label="Bloqueado" className="absolute grid place-items-center rounded-full bg-card text-foreground shadow" style={{ right: `${-14 * inv}px`, top: `${-14 * inv}px`, width: `${24 * inv}px`, height: `${24 * inv}px`, zIndex: 6 }}>
          <Lock style={{ width: `${12 * inv}px`, height: `${12 * inv}px` }} aria-hidden />
        </span>
      )}
      {handles.map((id) => (
        <span key={id} role="presentation" data-handle={id} style={handleStyle(id, inv) as CSSProperties} onPointerDown={(event) => props.onHandleDown(event, el, id)} />
      ))}
    </div>
  );
}
