"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import type { Guide } from "@/lib/designer/canvas-math";
import type { DesignDoc, DesignElement, HtmlElement, TextElement } from "@/lib/designer/doc/schema";
import { FORMATS } from "@/lib/designer/formats";
import type { UploadedFont } from "@/lib/designer/fonts";
import { backgroundLayers, renderPageHTML, rewriteAssetRefs, toReactStyle } from "@/lib/designer/render/page-html";
import {
  boxRectStyle,
  guideLineStyle,
  marqueeBox,
  passedThreshold,
  rectCenter,
  rectToBox,
  safeInset,
  startCorner,
  startMove,
  startRotate,
  startSide,
  updateCorner,
  updateMove,
  updateRotate,
  updateSide,
  type CornerSession,
  type GestureResult,
  type HandleId,
  type MoveSession,
  type PageGeometry,
  type Point,
  type RotateSession,
  type ScreenRect,
  type SideSession,
} from "@/lib/designer/screens/canvas-session";
import type { Box } from "@/lib/designer/canvas-math";
import { boxOf, type ElementPatch } from "@/lib/designer/screens/doc-ops";
import { designBox, designPoint, htmlTextOf, type ScreenBox } from "@/lib/designer/screens/html-texts";
import { clear, clickElement, dragGroup, isSelected, movableIds, selectHtmlText, selectRect, startEditing, stopEditing, type SelectionState } from "@/lib/designer/screens/selection";
import { pageDesignHeight } from "@/lib/designer/screens/thumbs";
import { inverseScale, pinchScale, pointerDistance, scaledSize, wheelZoom, zoomScale, type ZoomMode } from "@/lib/designer/screens/zoom";
import { ElementView } from "./element-view";
import { HtmlTextEditor, type HtmlTextLook } from "./html-text-editor";
import type { TextEditorHandle } from "./text-editor";

export interface CanvasHandle {
  /** «{ } Insertar variable» en el texto que se está escribiendo. */
  insertVariable: (key: string) => void;
  /** El alto real de cada texto, en % de la página (los textos no tienen alto propio). */
  measureHeights: () => Record<string, number>;
}

type Active =
  | { kind: "move"; session: MoveSession; started: boolean; pointerId: number; tapToEdit: string | null }
  | { kind: "side"; session: SideSession; started: boolean; pointerId: number }
  | { kind: "corner"; session: CornerSession; started: boolean; pointerId: number }
  | { kind: "rotate"; session: RotateSession; started: boolean; pointerId: number }
  | { kind: "marquee"; from: Point; additive: boolean; base: SelectionState; pointerId: number };

/** Dónde se escribe un texto que no se ve en el diseño (oculto o sin tamaño): arriba a la izquierda. */
const FALLBACK_SPOT: ScreenBox = { left: 16, top: 16, width: 240, height: 0 };

const toRect = (rect: DOMRect): ScreenRect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });

/**
 * El lienzo (F18, F19, F22): la página dibujada con DOM, con las mismas funciones de estilo que el render, y los gestos
 * (seleccionar, mover con imanes, tamaño, rotación, rectángulo de selección, zoom y pellizco) con Pointer Events.
 *
 * Este componente solo MIDE y PINTA: toda posición sale de `lib/designer/screens/canvas-session.ts` (que usa
 * `canvas-math`). Un test de frontera lo controla.
 */
export function CanvasStage({
  doc,
  pageIndex,
  selection,
  onSelection,
  assetUrls,
  uploadedFonts,
  labelFor,
  values,
  readOnly,
  zoom,
  onZoom,
  onGestureStart,
  onGesturePatch,
  onGestureEnd,
  onTextChange,
  onHtmlTextChange,
  onChipTap,
  mobilePreview,
  handleRef,
}: {
  doc: DesignDoc;
  pageIndex: number;
  selection: SelectionState;
  onSelection: (next: SelectionState) => void;
  assetUrls: Readonly<Record<string, string>>;
  uploadedFonts: readonly UploadedFont[];
  labelFor: (key: string) => string;
  values: Readonly<Record<string, string>> | null;
  readOnly: boolean;
  zoom: ZoomMode;
  onZoom: (mode: ZoomMode) => void;
  onGestureStart: () => void;
  onGesturePatch: (patches: Record<string, ElementPatch>) => void;
  onGestureEnd: () => void;
  onTextChange: (el: TextElement, text: string) => void;
  /** Se escribió un texto de adentro de un HTML cargado (su marca `data-tx`). */
  onHtmlTextChange: (el: HtmlElement, tx: string, text: string) => void;
  onChipTap: (el: TextElement, nodeIndex: number, rect: DOMRect) => void;
  /** Página web en «Celular»: el render público a 390 px, en lugar del lienzo. */
  mobilePreview: string | null;
  handleRef?: Ref<CanvasHandle>;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<TextEditorHandle>(null);
  const active = useRef<Active | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);

  const [viewport, setViewport] = useState({ width: 900, height: 600 });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [dragging, setDragging] = useState(false);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [override, setOverride] = useState<{ zoom: ZoomMode; scale: number } | null>(null);
  /** Los iframes de los bloques HTML (por id): el editor lee su contenido para ubicar cada texto. */
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const [frameTick, setFrameTick] = useState(0);
  const [textSpot, setTextSpot] = useState<{ box: ScreenBox | null; look: HtmlTextLook | null } | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const format = FORMATS[doc.format];
  const page = doc.pages[pageIndex] ?? doc.pages[0];
  const web = doc.format === "web";
  const designWidth = format.width;
  const designHeight = pageDesignHeight(doc, pageIndex);

  // El espacio disponible: el lienzo se ajusta cuando cambia el tamaño de la ventana o se abre un panel.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewport({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    setViewport({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, [mobilePreview]);

  const scale = override && override.zoom === zoom ? override.scale : zoomScale(zoom, viewport, { width: designWidth, height: designHeight }, { fitWidthOnly: web });
  const inv = inverseScale(scale);
  const size = scaledSize({ width: designWidth, height: designHeight }, scale);

  const geometry = useCallback((): PageGeometry => ({ width: designWidth, height: designHeight, scale, safeZone: format.safeZone }), [designWidth, designHeight, scale, format.safeZone]);
  const pageRect = (): ScreenRect => toRect((pageRef.current as HTMLDivElement).getBoundingClientRect());

  const domRectOf = (id: string): ScreenRect | null => {
    const node = stageRef.current?.querySelector<HTMLElement>(`[data-el-id="${id}"]`);
    return node ? toRect(node.getBoundingClientRect()) : null;
  };

  /** El nodo de un texto marcado dentro del iframe de su bloque (o `null` si el iframe todavía no cargó). */
  const textNodeIn = (elId: string, tx: string): HTMLElement | null => {
    const inner = frames.current.get(elId)?.contentDocument;
    if (!inner) return null;
    return [...inner.querySelectorAll<HTMLElement>("[data-tx]")].find((node) => node.getAttribute("data-tx") === tx) ?? null;
  };

  /** El texto marcado que está bajo el puntero, dentro del iframe de un bloque HTML. */
  const hitText = (elId: string, clientX: number, clientY: number): string | null => {
    const inner = frames.current.get(elId)?.contentDocument;
    if (!inner || !pageRef.current) return null;
    const point = designPoint({ x: clientX, y: clientY }, pageRect(), scale);
    return inner.elementFromPoint(point.x, point.y)?.closest("[data-tx]")?.getAttribute("data-tx") ?? null;
  };

  /** La caja de un elemento en % de la página: el alto de un texto sale de lo que mide en pantalla. */
  const boxFor = (el: DesignElement): Box => {
    const rect = domRectOf(el.id);
    const measured = el.type === "text" && rect ? rectToBox(rect, pageRect()).h : undefined;
    return boxOf(el, doc, pageIndex, measured);
  };

  useImperativeHandle(handleRef, () => ({
    insertVariable: (key) => textRef.current?.insertVariable(key),
    measureHeights: () => {
      const out: Record<string, number> = {};
      if (!pageRef.current) return out;
      const rect = pageRect();
      for (const el of page.elements) {
        const domRect = domRectOf(el.id);
        if (el.type === "text" && domRect) out[el.id] = rectToBox(domRect, rect).h;
      }
      return out;
    },
  }));

  // Ctrl/⌘ + rueda: zoom. Va como oyente nativo (no pasivo) para poder frenar el zoom del navegador.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      onZoom(wheelZoom(zoom, event.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, onZoom]);

  // ─── Gestos ──────────────────────────────────────────────────────────────

  function finish(commit: boolean) {
    const current = active.current;
    active.current = null;
    setGuides([]);
    setDragging(false);
    setMarquee(null);
    if (current && current.kind !== "marquee" && current.started && commit) onGestureEnd();
  }

  function apply(current: Exclude<Active, { kind: "marquee" }>, result: GestureResult) {
    if (!current.started) {
      current.started = true;
      onGestureStart();
    }
    setDragging(true);
    setGuides(result.guides);
    onGesturePatch(result.patches);
  }

  function onElementPointerDown(event: ReactPointerEvent<HTMLDivElement>, el: DesignElement) {
    if (readOnly || event.button > 0) return;
    if (selection.editing === el.id && el.type === "text") return; // el cursor es del navegador
    event.stopPropagation();
    if (pointers.current.size > 0) return;
    // Un HTML cargado: tocar uno de sus textos lo elige (y no arrastra la página entera).
    const tx = el.type === "html" && !event.shiftKey ? hitText(el.id, event.clientX, event.clientY) : null;
    if (tx) {
      const same = selection.ids.length === 1 && selection.text?.el === el.id && selection.text.tx === tx;
      if (same && selection.editing === el.id) return;
      // En pantallas táctiles no hay doble clic: tocar de nuevo el mismo texto entra a escribir.
      onSelection(same && event.pointerType !== "mouse" ? startEditing(selection, el) : selectHtmlText(selection, el.id, tx));
      return;
    }
    const alreadySelected = isSelected(selection, el.id);
    const wasSole = alreadySelected && selection.ids.length === 1;
    const next = alreadySelected && !event.shiftKey ? { ...selection, editing: null, text: null } : clickElement(selection, el.id, event.shiftKey);
    onSelection(next);
    if (event.shiftKey) return;
    const ids = movableIds(next, page.elements.filter((e) => dragGroup(next, el.id).includes(e.id)));
    const boxes: Record<string, Box> = {};
    for (const id of ids) {
      const target = page.elements.find((e) => e.id === id);
      if (target) boxes[id] = boxFor(target);
    }
    const others = page.elements.filter((e) => !ids.includes(e.id) && !e.hidden).map((e) => boxFor(e));
    const session = startMove({ geometry: geometry(), pointer: { x: event.clientX, y: event.clientY }, boxes, others });
    if (!session) return;
    // Tocar de nuevo un texto ya elegido entra a escribir (en pantallas táctiles no hay doble clic).
    active.current = { kind: "move", session, started: false, pointerId: event.pointerId, tapToEdit: wasSole && el.type === "text" && event.pointerType !== "mouse" ? el.id : null };
    stageRef.current?.setPointerCapture(event.pointerId);
  }

  function onHandleDown(event: ReactPointerEvent<HTMLElement>, el: DesignElement, handle: HandleId) {
    if (readOnly || el.locked) return;
    event.stopPropagation();
    event.preventDefault();
    const pointer = { x: event.clientX, y: event.clientY };
    const box = boxFor(el);
    if (handle === "rotate") {
      const rect = domRectOf(el.id);
      if (!rect) return;
      active.current = { kind: "rotate", session: startRotate({ id: el.id, center: rectCenter(rect) }), started: false, pointerId: event.pointerId };
    } else if (handle === "corner") {
      active.current = { kind: "corner", session: startCorner({ geometry: geometry(), pointer, id: el.id, box, fontSize: el.type === "text" ? el.size : null }), started: false, pointerId: event.pointerId };
    } else {
      active.current = { kind: "side", session: startSide({ geometry: geometry(), pointer, id: el.id, side: handle, box }), started: false, pointerId: event.pointerId };
    }
    stageRef.current?.setPointerCapture(event.pointerId);
  }

  function onStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size === 2) {
        // El segundo dedo: pellizco. Lo que se estaba arrastrando se suelta.
        finish(true);
        const [a, b] = [...pointers.current.values()];
        pinch.current = { distance: pointerDistance(a, b), scale };
        return;
      }
    }
    if (readOnly || event.button > 0 || active.current) return;
    // Un clic en vacío suelta la selección (Shift la conserva); arrastrar en vacío dibuja un rectángulo que selecciona.
    const additive = event.shiftKey;
    const base = additive ? selection : clear(selection);
    onSelection(base);
    if (event.pointerType !== "touch" && pageRef.current) {
      active.current = { kind: "marquee", from: { x: event.clientX, y: event.clientY }, additive, base, pointerId: event.pointerId };
      stageRef.current?.setPointerCapture(event.pointerId);
    }
  }

  function onStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      setOverride({ zoom, scale: pinchScale(pinch.current.scale, pinch.current.distance, pointerDistance(a, b)) });
      return;
    }
    const current = active.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const pointer = { x: event.clientX, y: event.clientY };
    switch (current.kind) {
      case "move": {
        const out = updateMove(current.session, pointer, { alt: event.altKey });
        if (!out) return;
        current.session = out.session;
        current.tapToEdit = null;
        apply(current, out.result);
        return;
      }
      case "side": {
        const out = updateSide(current.session, pointer);
        current.session = out.session;
        apply(current, out.result);
        return;
      }
      case "corner": {
        const out = updateCorner(current.session, pointer);
        current.session = out.session;
        apply(current, out.result);
        return;
      }
      case "rotate": {
        const out = updateRotate(current.session, pointer, { shift: event.shiftKey });
        current.session = out.session;
        apply(current, out.result);
        return;
      }
      case "marquee": {
        if (!passedThreshold(current.from, pointer) || !pageRef.current) return;
        const box = marqueeBox(current.from, pointer, pageRect());
        setMarquee(box);
        const items = page.elements.map((el) => ({ id: el.id, box: boxFor(el), hidden: el.hidden }));
        onSelection(selectRect(current.base, items, box, current.additive));
      }
    }
  }

  function onStagePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const current = active.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.kind === "move" && !current.started && current.tapToEdit) {
      const target = page.elements.find((e) => e.id === current.tapToEdit);
      if (target) onSelection(startEditing(selection, target));
    }
    stageRef.current?.releasePointerCapture?.(event.pointerId);
    finish(true);
  }

  function onStagePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    finish(true);
  }

  // ─── Lo que se dibuja ────────────────────────────────────────────────────

  const htmlElements = page.elements.filter((el): el is Extract<DesignElement, { type: "html" }> => el.type === "html" && !el.hidden);
  /** Un bloque cargado de HTML va SIEMPRE en un iframe con `sandbox` (sin `allow-scripts`): nunca dentro del documento de la app. */
  const htmlDocs = useMemo(() => {
    const assetUrl = (path: string) => assetUrls[path] ?? "";
    return htmlElements.map((el) => ({
      id: el.id,
      z: page.elements.indexOf(el) + 1,
      srcDoc: renderPageHTML(
        { ...doc, pages: [{ id: page.id, background: { type: "color", color: "#00000000" }, elements: [el], ...(web ? { height: designHeight } : {}) }] },
        0,
        { mode: "edit", assetUrl, uploadedFonts: [...uploadedFonts], values: values ?? undefined, variableLabel: labelFor },
      ),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depende de los bloques HTML, no de cada movimiento
  }, [htmlElements.map((e) => e.id + e.html + (e.css ?? "")).join("|"), assetUrls, uploadedFonts, values, designHeight, doc.format]);

  const rewrite = (decl: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const [prop, value] of Object.entries(decl)) out[prop] = rewriteAssetRefs(value, (path) => assetUrls[path] ?? "");
    return out;
  };

  // El texto elegido de un HTML cargado: dónde está (para el recuadro y el campo de escribir) y cómo se ve.
  const chosen = selection.text && selection.ids.length === 1 && selection.ids[0] === selection.text.el ? selection.text : null;
  const chosenEl = chosen ? page.elements.find((e): e is HtmlElement => e.id === chosen.el && e.type === "html") ?? null : null;
  useLayoutEffect(() => {
    if (!chosen) {
      setTextSpot(null);
      return;
    }
    const node = textNodeIn(chosen.el, chosen.tx);
    if (!node) {
      setTextSpot(null);
      return;
    }
    const cs = node.ownerDocument.defaultView?.getComputedStyle(node);
    const look: HtmlTextLook | null = cs
      ? { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textAlign: cs.textAlign, textTransform: cs.textTransform }
      : null;
    setTextSpot({ box: designBox(node.getBoundingClientRect()), look });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se vuelve a medir cuando cambia el texto elegido o se recarga el iframe
  }, [chosen?.el, chosen?.tx, frameTick, htmlDocs]);

  if (mobilePreview !== null) {
    return (
      <div ref={stageRef} className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted p-4">
        <iframe title="Vista del celular" sandbox="" srcDoc={mobilePreview} className="h-full min-h-[480px] w-[390px] max-w-full rounded-[28px] border-[6px] border-foreground/80 bg-white shadow-lg" />
      </div>
    );
  }

  const sole = selection.ids.length === 1 ? selection.ids[0] : null;

  return (
    <div
      ref={stageRef}
      className="flex min-h-0 flex-1 overflow-auto bg-muted p-[22px]"
      style={{ touchAction: "pan-x pan-y" }}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={onStagePointerUp}
      onPointerCancel={onStagePointerCancel}
    >
      <div className="relative m-auto shrink-0" style={{ width: size.width, height: size.height }}>
        <div
          ref={pageRef}
          data-canvas-page
          className="absolute left-0 top-0 bg-white shadow-lg"
          style={{ width: designWidth, height: designHeight, transform: `scale(${scale})`, transformOrigin: "0 0" }}
        >
          {backgroundLayers(page).map((layer) => (
            <div key={layer.kind} aria-hidden style={toReactStyle(rewrite(layer.style)) as CSSProperties} />
          ))}

          {htmlDocs.map((h) => (
            // `allow-same-origin` (nunca `allow-scripts`): el editor lee el contenido para ubicar cada texto. Adentro no
            // corre nada: lo impiden el `sandbox` y la política del render de edición (`EDIT_CSP`).
            <iframe
              key={h.id}
              ref={(node) => {
                if (node) frames.current.set(h.id, node);
                else frames.current.delete(h.id);
              }}
              onLoad={() => setFrameTick((t) => t + 1)}
              title="Bloque cargado"
              sandbox="allow-same-origin"
              srcDoc={h.srcDoc}
              tabIndex={-1}
              aria-hidden
              style={{ position: "absolute", left: 0, top: 0, width: designWidth, height: designHeight, border: 0, background: "transparent", pointerEvents: "none", zIndex: h.z }}
            />
          ))}

          {page.elements.map((el, index) => (
              <ElementView
                key={el.id}
                el={el}
                zIndex={index + 1}
                assetUrls={assetUrls}
                labelFor={labelFor}
                values={values}
                selected={isSelected(selection, el.id) && chosen?.el !== el.id}
                sole={sole === el.id && chosen?.el !== el.id}
                editing={selection.editing === el.id}
                inverseScale={inv}
                readOnly={readOnly}
                onPointerDown={onElementPointerDown}
                onDoubleClick={(target) => !readOnly && onSelection(startEditing(selection, target))}
                onHandleDown={onHandleDown}
                onTextChange={onTextChange}
                onExitEdit={() => onSelection({ ...selection, editing: null })}
                onChipTap={onChipTap}
                textHandleRef={selection.editing === el.id ? textRef : undefined}
              />
          ))}

          {chosen && chosenEl && textSpot?.box && selection.editing !== chosen.el && (
            <div aria-hidden style={{ position: "absolute", ...textSpot.box, border: `${2 * inv}px solid var(--primary-edge)`, borderRadius: 4 * inv, pointerEvents: "none", zIndex: 3000 }} />
          )}
          {chosen && chosenEl && selection.editing === chosen.el && !readOnly && (
            <HtmlTextEditor
              key={`${chosen.el}:${chosen.tx}`}
              text={htmlTextOf(chosenEl, chosen.tx) ?? ""}
              box={textSpot?.box ?? FALLBACK_SPOT}
              look={textSpot?.look ?? null}
              inverseScale={inv}
              zIndex={3002}
              labelFor={labelFor}
              onCommit={(text) => onHtmlTextChange(chosenEl, chosen.tx, text)}
              onExit={() => onSelection(stopEditing(selectionRef.current))}
              onChipTap={() => undefined}
              handleRef={textRef}
            />
          )}

          {dragging && <div aria-hidden style={{ position: "absolute", inset: safeInset(format.safeZone), border: `${2 * inv}px dashed rgba(34,211,238,.6)`, pointerEvents: "none", zIndex: 2999 }} />}
          {guides.map((guide, i) => (
            <div key={i} aria-hidden style={guideLineStyle(guide, inv) as CSSProperties} />
          ))}
          {marquee && <div aria-hidden className="pointer-events-none absolute border border-primary-edge bg-primary/10" style={{ ...boxRectStyle(marquee), zIndex: 3001 }} />}
        </div>
      </div>
    </div>
  );
}
