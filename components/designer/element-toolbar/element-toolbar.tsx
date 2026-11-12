"use client";

import { useRef, type ReactNode } from "react";
import {
  AlignCenter,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Italic,
  Loader2,
  Lock,
  Trash2,
  Unlock,
  Upload,
} from "lucide-react";
import type { AlignMode } from "@/lib/designer/canvas-math";
import type { DesignElement, ImageElement, ShapeElement, TextElement } from "@/lib/designer/doc/schema";
import { curatedFont, fontGroups, type UploadedFont } from "@/lib/designer/fonts";
import type { ElementPatch } from "@/lib/designer/screens/doc-ops";
import {
  replaceImage,
  setAlign,
  setColor,
  setFill,
  setFontFamily,
  setHighlight,
  setImageFit,
  setLetterSpacing,
  setLineHeight,
  setOpacity,
  setRadius,
  setSize,
  setStroke,
  setWeight,
  stepSize,
  toggleItalic,
  toggleShadow,
  toggleUppercase,
  toolbarFor,
  type ControlId,
  type GroupId,
} from "@/lib/designer/screens/element-toolbar";
import { layerName, type OrderAction } from "@/lib/designer/screens/layers";
import { IMAGE_ACCEPT } from "@/lib/designer/screens/uploads";
import { cn } from "@/lib/utils";
import { useImageUpload } from "@/components/designer/editor/use-image-upload";
import { useFontPreviews } from "@/components/designer/editor/use-fonts";
import { ColorPicker } from "./color-picker";

export interface ElementToolbarProps {
  element: DesignElement;
  isTemplate: boolean;
  readOnly: boolean;
  labelFor: (key: string) => string;
  googleFonts: readonly string[];
  uploadedFonts: readonly UploadedFont[];
  brandColor: string | null;
  palette: readonly string[];
  usedColors: readonly string[];
  order: Record<OrderAction, boolean>;
  onPatch: (patch: ElementPatch) => void;
  onOrder: (action: OrderAction) => void;
  onAlign: (mode: AlignMode) => void;
  onDuplicate: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
  onDone: () => void;
  onInsertVariable: (anchor: HTMLElement) => void;
  /** Se está escribiendo un texto de adentro de un HTML cargado (ofrece «Insertar variable»). */
  htmlTextEditing?: boolean;
  onImageUploaded: (file: { path: string; url: string }) => void;
  /** `bar`: una fila de la computadora. `sheet`: los grupos de una pestaña de la hoja del celular. */
  mode: { kind: "bar" } | { kind: "sheet"; groups: GroupId[] };
}

/** Un botón de la barra: no le saca el foco al texto que se está escribiendo. */
function ToolButton({ label, onClick, pressed, disabled, children, className }: { label: string; onClick: () => void; pressed?: boolean; disabled?: boolean; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn("grid h-7 min-w-7 shrink-0 place-items-center rounded-md border border-border bg-card px-1.5 text-[13px] hover:bg-accent disabled:opacity-35", pressed && "border-primary-edge bg-primary/15", className)}
    >
      {children}
    </button>
  );
}

const field = "h-7 rounded-md border border-input bg-background px-1.5 text-[12.5px] focus:border-primary-edge focus:outline-none";

export function ElementToolbar(props: ElementToolbarProps) {
  const { element: el, isTemplate, readOnly } = props;
  const groups = toolbarFor(el, isTemplate, { htmlTextEditing: props.htmlTextEditing }).filter((g) => (props.mode.kind === "sheet" ? props.mode.groups.includes(g.id) : true));
  const { upload, busy, error } = useImageUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const variableRef = useRef<HTMLButtonElement>(null);
  const bar = props.mode.kind === "bar";

  const text = el.type === "text" ? el : null;
  const image = el.type === "image" ? el : null;
  const shape = el.type === "shape" ? el : null;

  async function replace(file: File | undefined) {
    if (!file || !image) return;
    const uploaded = await upload(file);
    if (!uploaded) return;
    props.onImageUploaded({ path: uploaded.path, url: uploaded.url });
    props.onPatch(replaceImage(image, uploaded.path));
  }

  function renderControl(id: ControlId): ReactNode {
    switch (id) {
      case "name":
        return (
          <span key={id} className="max-w-[150px] truncate text-[13px] font-semibold" title={layerName(el, props.labelFor)}>
            {layerName(el, props.labelFor)}
          </span>
        );
      case "order":
        return (
          <span key={id} className="flex items-center gap-1" role="group" aria-label="Orden">
            <ToolButton label="Traer al frente (⌘ ])" onClick={() => props.onOrder("front")} disabled={!props.order.front}>
              <ArrowUpToLine className="h-3.5 w-3.5" aria-hidden />
            </ToolButton>
            <ToolButton label="Traer adelante (])" onClick={() => props.onOrder("forward")} disabled={!props.order.forward}>
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            </ToolButton>
            <ToolButton label="Enviar atrás ([)" onClick={() => props.onOrder("backward")} disabled={!props.order.backward}>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </ToolButton>
            <ToolButton label="Enviar al fondo (⌘ [)" onClick={() => props.onOrder("back")} disabled={!props.order.back}>
              <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
            </ToolButton>
          </span>
        );
      case "font":
        return text ? <FontSelect key={id} el={text} google={props.googleFonts} uploaded={props.uploadedFonts} onPatch={props.onPatch} /> : null;
      case "weight": {
        if (!text) return null;
        const weights = curatedFont(text.font.family)?.weights ?? [100, 200, 300, 400, 500, 600, 700, 800, 900];
        return (
          <select key={id} aria-label="Peso" value={text.font.weight} onChange={(e) => props.onPatch(setWeight(text, Number(e.target.value)))} className={cn(field, "w-[88px]")}>
            {!weights.includes(text.font.weight) && <option value={text.font.weight}>{text.font.weight}</option>}
            {weights.map((w) => (
              <option key={w} value={w}>
                {WEIGHT_NAMES[w] ?? w}
              </option>
            ))}
          </select>
        );
      }
      case "size":
        return text ? (
          <span key={id} className="flex items-center gap-1" role="group" aria-label="Tamaño de letra">
            <ToolButton label="Achicar la letra" onClick={() => props.onPatch(stepSize(text, -1))}>
              A−
            </ToolButton>
            <input
              type="number"
              aria-label="Tamaño de letra en píxeles"
              value={text.size}
              min={4}
              max={1000}
              onChange={(e) => e.target.value !== "" && props.onPatch(setSize(text, Number(e.target.value)))}
              className={cn(field, "w-14 text-center")}
            />
            <ToolButton label="Agrandar la letra" onClick={() => props.onPatch(stepSize(text, 1))}>
              A+
            </ToolButton>
          </span>
        ) : null;
      case "italic":
        return text ? (
          <ToolButton key={id} label="Cursiva" pressed={!!text.font.italic} onClick={() => props.onPatch(toggleItalic(text))}>
            <Italic className="h-3.5 w-3.5" aria-hidden />
          </ToolButton>
        ) : null;
      case "uppercase":
        return text ? (
          <ToolButton key={id} label="Mayúsculas" pressed={text.transform === "uppercase"} onClick={() => props.onPatch(toggleUppercase(text))}>
            <span className="text-[11px] font-bold">AA</span>
          </ToolButton>
        ) : null;
      case "lineHeight":
        return text ? (
          <label key={id} className="flex items-center gap-1 text-xs text-muted-foreground">
            Interlineado
            <input type="number" step={0.1} min={0.5} max={4} value={text.lineHeight ?? 1.2} onChange={(e) => e.target.value !== "" && props.onPatch(setLineHeight(text, Number(e.target.value)))} className={cn(field, "w-14")} />
          </label>
        ) : null;
      case "letterSpacing":
        return text ? (
          <label key={id} className="flex items-center gap-1 text-xs text-muted-foreground">
            Espaciado
            <input type="number" step={0.5} min={-50} max={200} value={text.letterSpacing ?? 0} onChange={(e) => e.target.value !== "" && props.onPatch(setLetterSpacing(text, Number(e.target.value)))} className={cn(field, "w-14")} />
          </label>
        ) : null;
      case "align":
        return text ? (
          <span key={id} className="flex items-center gap-1" role="group" aria-label="Alineación">
            {(
              [
                ["left", "Izquierda", AlignLeft],
                ["center", "Centrado", AlignCenter],
                ["right", "Derecha", AlignRight],
                ["justify", "Justificado", AlignJustify],
              ] as const
            ).map(([value, label, Icon]) => (
              <ToolButton key={value} label={label} pressed={text.align === value} onClick={() => props.onPatch(setAlign(text, value))}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </ToolButton>
            ))}
          </span>
        ) : null;
      case "color":
        return text ? (
          <ColorPicker key={id} label="Color" value={text.color} brandColor={props.brandColor} palette={props.palette} used={props.usedColors} onChange={(c) => c && props.onPatch(setColor(text, c))} />
        ) : null;
      case "highlight":
        return text ? (
          <span key={id} className="flex items-center gap-1.5">
            <ColorPicker
              label="Resaltado"
              value={text.highlight?.color ?? null}
              allowNone
              brandColor={props.brandColor}
              palette={props.palette}
              used={props.usedColors}
              onChange={(c) => props.onPatch(setHighlight(text, c ? { color: c, opacity: text.highlight?.opacity ?? 0.6 } : null))}
            />
            {text.highlight && (
              <input
                type="range"
                aria-label="Opacidad del resaltado"
                min={0}
                max={100}
                value={Math.round(text.highlight.opacity * 100)}
                onChange={(e) => props.onPatch(setHighlight(text, { color: text.highlight!.color, opacity: Number(e.target.value) / 100 }))}
                className="w-16"
              />
            )}
          </span>
        ) : null;
      case "shadow":
        return text ? (
          <ToolButton key={id} label="Sombra" pressed={!!text.shadow} onClick={() => props.onPatch(toggleShadow(text))}>
            <Bold className="h-3.5 w-3.5 [filter:drop-shadow(1px_1px_0_currentColor)]" aria-hidden />
          </ToolButton>
        ) : null;
      case "variable":
        return text || props.htmlTextEditing ? (
          <button
            key={id}
            ref={variableRef}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => variableRef.current && props.onInsertVariable(variableRef.current)}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-primary-edge bg-primary/10 px-2 text-xs font-medium text-primary-ink hover:bg-primary/20"
          >
            {"{ }"} Insertar variable <ChevronDown className="h-3 w-3" aria-hidden />
          </button>
        ) : null;
      case "replace":
        return image ? (
          <span key={id} className="flex items-center gap-1.5">
            <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => void replace(e.target.files?.[0]).then(() => (e.target.value = ""))} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-accent disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />}
              Reemplazar
            </button>
            {error && <span role="alert" className="text-xs text-bad">{error}</span>}
          </span>
        ) : null;
      case "fit":
        return image ? (
          <select key={id} aria-label="Ajuste de la imagen" value={image.fit} onChange={(e) => props.onPatch(setImageFit(image, e.target.value as ImageElement["fit"]))} className={cn(field, "w-[110px]")}>
            <option value="cover">Cubrir</option>
            <option value="contain">Contener</option>
          </select>
        ) : null;
      case "radius":
        return image || shape ? (
          <label key={id} className="flex items-center gap-1 text-xs text-muted-foreground">
            Esquinas
            <input type="number" min={0} max={2000} value={(image ?? shape)?.radius ?? 0} onChange={(e) => e.target.value !== "" && props.onPatch(setRadius((image ?? shape) as ImageElement | ShapeElement, Number(e.target.value)))} className={cn(field, "w-16")} />
          </label>
        ) : null;
      case "opacity":
        return (
          <label key={id} className="flex items-center gap-1 text-xs text-muted-foreground">
            Opacidad
            <input type="range" min={0} max={100} value={Math.round((el.opacity ?? 1) * 100)} onChange={(e) => props.onPatch(setOpacity(el, Number(e.target.value) / 100))} className="w-20" />
          </label>
        );
      case "fill":
        return shape ? (
          <ColorPicker key={id} label="Relleno" value={shape.fill ?? null} allowNone brandColor={props.brandColor} palette={props.palette} used={props.usedColors} onChange={(c) => props.onPatch(setFill(shape, c))} />
        ) : null;
      case "stroke":
        return shape ? (
          <span key={id} className="flex items-center gap-1.5">
            <ColorPicker label="Borde" value={shape.stroke?.color ?? null} allowNone brandColor={props.brandColor} palette={props.palette} used={props.usedColors} onChange={(c) => props.onPatch(setStroke(shape, c ? { color: c, width: shape.stroke?.width || 4 } : null))} />
            {shape.stroke && (
              <input type="number" aria-label="Grosor del borde" min={0} max={200} value={shape.stroke.width} onChange={(e) => e.target.value !== "" && props.onPatch(setStroke(shape, { color: shape.stroke!.color, width: Number(e.target.value) }))} className={cn(field, "w-14")} />
            )}
          </span>
        ) : null;
      case "alignPage":
        return (
          <span key={id} className="flex items-center gap-1" role="group" aria-label="Alinear a la página">
            {(
              [
                ["left", "Alinear a la izquierda de la página", AlignStartVertical],
                ["center", "Centrar en la página (horizontal)", AlignHorizontalJustifyCenter],
                ["right", "Alinear a la derecha de la página", AlignEndVertical],
                ["top", "Alinear arriba de la página", AlignStartHorizontal],
                ["middle", "Centrar en la página (vertical)", AlignVerticalJustifyCenter],
                ["bottom", "Alinear abajo de la página", AlignEndHorizontal],
              ] as const
            ).map(([mode, label, Icon]) => (
              <ToolButton key={mode} label={label} onClick={() => props.onAlign(mode)} disabled={!!el.locked}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </ToolButton>
            ))}
          </span>
        );
      case "duplicate":
        return (
          <ToolButton key={id} label="Duplicar (⌘ D)" onClick={props.onDuplicate}>
            <Copy className="h-3.5 w-3.5" aria-hidden />
          </ToolButton>
        );
      case "lock":
        return (
          <ToolButton key={id} label={el.locked ? "Desbloquear" : "Bloquear"} pressed={!!el.locked} onClick={props.onToggleLock}>
            {el.locked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <Unlock className="h-3.5 w-3.5" aria-hidden />}
          </ToolButton>
        );
      case "delete":
        return (
          <ToolButton key={id} label="Eliminar (Supr)" onClick={props.onDelete} className="text-bad">
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </ToolButton>
        );
      case "done":
        return (
          <ToolButton key={id} label="Listo (Esc)" onClick={props.onDone} className="inline-flex items-center gap-1 whitespace-nowrap px-2.5 text-xs font-medium">
            <Check className="h-3.5 w-3.5" aria-hidden /> Listo
          </ToolButton>
        );
    }
  }

  // Un elemento bloqueado se selecciona pero no se edita: solo se puede desbloquear, ordenar o soltar.
  const locked = !!el.locked;
  const editableControls: ControlId[] = ["name", "order", "lock", "done", "duplicate"];

  if (bar) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" role="toolbar" aria-label="Barra del elemento">
        {groups.map((group, index) => (
          <span key={group.id} className="flex flex-wrap items-center gap-1.5">
            {index > 0 && <span aria-hidden className="mx-1 h-5 w-px bg-border" />}
            {group.controls.filter((c) => !readOnly && (!locked || editableControls.includes(c))).map(renderControl)}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4" role="toolbar" aria-label="Barra del elemento">
      {groups.map((group) => (
        <section key={group.id} className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{group.label}</h3>
          <div className="flex flex-wrap items-center gap-2">{group.controls.filter((c) => !readOnly && (!locked || editableControls.includes(c))).map(renderControl)}</div>
        </section>
      ))}
    </div>
  );
}

const WEIGHT_NAMES: Record<number, string> = { 100: "Fina", 200: "Extra liviana", 300: "Liviana", 400: "Normal", 500: "Media", 600: "Seminegrita", 700: "Negrita", 800: "Extra negrita", 900: "Negra" };

/** El desplegable de tipografías agrupadas (curadas, de Google agregadas y subidas), cada opción escrita en su fuente. */
function FontSelect({ el, google, uploaded, onPatch }: { el: TextElement; google: readonly string[]; uploaded: readonly UploadedFont[]; onPatch: (patch: ElementPatch) => void }) {
  // Cada opción se ve en su fuente: se piden a Google solo cuando hay un texto elegido.
  useFontPreviews(true, google);
  const groups = fontGroups({ google: [...google], uploaded: [...uploaded] });
  const known = groups.some((g) => g.families.includes(el.font.family));
  return (
    <select aria-label="Tipografía" value={el.font.family} onChange={(e) => onPatch(setFontFamily(el, e.target.value))} className={cn(field, "w-[150px]")} style={{ fontFamily: `"${el.font.family}"` }}>
      {!known && <option value={el.font.family}>{el.font.family}</option>}
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.families.map((family) => (
            <option key={family} value={family} style={{ fontFamily: `"${family}", sans-serif` }}>
              {family}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
