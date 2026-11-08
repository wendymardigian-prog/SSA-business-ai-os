"use client";

import { useRef, useState } from "react";
import { ImageIcon, Loader2, Square, Circle, Minus, Type, Upload } from "lucide-react";
import { listUploadedImages } from "@/lib/actions/designer/designs";
import type { DesignElement, DesignPage } from "@/lib/designer/doc/schema";
import type { FormatKey } from "@/lib/designer/formats";
import {
  clearOverlay,
  DEFAULT_OVERLAY_OPACITY,
  OVERLAY_HELP,
  overlayOpacityFromPercent,
  overlayPercent,
  removeBackground,
  setBackgroundColor,
  setBackgroundFit,
  setBackgroundFocal,
  setBackgroundGradient,
  setBackgroundImage,
  setOverlay,
} from "@/lib/designer/screens/background";
import { pointToPct } from "@/lib/designer/screens/canvas-session";
import { FIT_OPTIONS } from "@/lib/designer/screens/config";
import { newImageElement, newShapeElement, newTextElement, readableTextColor, SHAPE_LABELS, TEXT_ROLE_LABELS, type ShapeKind, type TextRole } from "@/lib/designer/screens/starter-docs";
import { IMAGE_ACCEPT } from "@/lib/designer/screens/uploads";
import type { UploadedImage } from "@/lib/designer/designs-types";
import { ColorPicker } from "@/components/designer/element-toolbar/color-picker";
import { cn } from "@/lib/utils";
import { smallButton } from "./overlays";
import { useImageUpload } from "./use-image-upload";

const SHAPE_ICON = { rect: Square, circle: Circle, line: Minus } as const;
const h4 = "text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";

/**
 * La pestaña Agregar (F22, F23): texto (título, subtítulo y cuerpo con el tamaño del formato), imagen (subir una nueva o
 * elegir una de las ya subidas), forma y variable (solo plantillas); y el Fondo: color, degradé o imagen (ajuste, punto
 * focal y la capa de color encima, de 0 a 90 %). Todo se agrega centrado en la página que se ve y queda seleccionado.
 */
export function AddPanel({
  format,
  pageNumber,
  page,
  isTemplate,
  readOnly,
  brandColor,
  palette,
  usedColors,
  assetUrls,
  onAdd,
  onPage,
  onAssetUrl,
  onVariableMenu,
}: {
  format: FormatKey;
  pageNumber: number;
  page: DesignPage;
  isTemplate: boolean;
  readOnly: boolean;
  brandColor: string | null;
  palette: readonly string[];
  usedColors: readonly string[];
  assetUrls: Readonly<Record<string, string>>;
  onAdd: (element: DesignElement) => void;
  onPage: (update: (page: DesignPage) => DesignPage) => void;
  onAssetUrl: (path: string, url: string) => void;
  onVariableMenu: (anchor: HTMLElement) => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const bgInput = useRef<HTMLInputElement>(null);
  const variableButton = useRef<HTMLButtonElement>(null);
  const { upload, busy, error, clearError } = useImageUpload();
  const [library, setLibrary] = useState<UploadedImage[] | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const bg = page.background;
  const accent = brandColor ?? "#4f46e5";
  const textColor = readableTextColor(bg.type === "color" ? bg.color : bg.type === "gradient" ? bg.gradient?.from : "#000000");

  async function addImage(file: File | undefined) {
    if (!file) return;
    const uploaded = await upload(file);
    if (!uploaded) return;
    onAssetUrl(uploaded.path, uploaded.url);
    onAdd(newImageElement(format, uploaded.path));
  }

  async function setBackground(file: File | undefined) {
    if (!file) return;
    const uploaded = await upload(file);
    if (!uploaded) return;
    onAssetUrl(uploaded.path, uploaded.url);
    onPage((p) => setBackgroundImage(p, uploaded.path));
  }

  async function openLibrary() {
    if (library || loadingLibrary) return;
    setLoadingLibrary(true);
    setLibraryError(null);
    const result = await listUploadedImages();
    setLoadingLibrary(false);
    if (!result.ok) {
      setLibraryError(result.error);
      return;
    }
    result.data.forEach((img) => onAssetUrl(img.path, img.url));
    setLibrary(result.data);
  }

  const sectionDisabled = readOnly ? "pointer-events-none opacity-50" : "";

  return (
    <div className={cn("flex flex-col gap-4 p-3.5", sectionDisabled)}>
      <section className="flex flex-col gap-2">
        <h3 className={h4}>Agregar a la página {pageNumber}</h3>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(TEXT_ROLE_LABELS) as TextRole[]).map((role) => (
            <button key={role} type="button" onClick={() => onAdd(newTextElement(format, role, { color: textColor }))} className="flex flex-col items-center gap-1 rounded-[10px] border border-border px-1.5 py-2.5 text-[12.5px] hover:bg-accent">
              <Type className="h-4 w-4" aria-hidden />
              {TEXT_ROLE_LABELS[role]}
            </button>
          ))}
          {(Object.keys(SHAPE_LABELS) as ShapeKind[]).map((shape) => {
            const Icon = SHAPE_ICON[shape];
            return (
              <button key={shape} type="button" onClick={() => onAdd(newShapeElement(format, shape, accent))} className="flex flex-col items-center gap-1 rounded-[10px] border border-border px-1.5 py-2.5 text-[12.5px] hover:bg-accent">
                <Icon className="h-4 w-4" aria-hidden />
                {SHAPE_LABELS[shape]}
              </button>
            );
          })}
          <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => void addImage(e.target.files?.[0]).then(() => (e.target.value = ""))} />
          <button type="button" disabled={busy} onClick={() => { clearError(); imageInput.current?.click(); }} className="flex flex-col items-center gap-1 rounded-[10px] border border-border px-1.5 py-2.5 text-[12.5px] hover:bg-accent disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
            Subir imagen
          </button>
          {isTemplate && (
            <button ref={variableButton} type="button" onClick={() => variableButton.current && onVariableMenu(variableButton.current)} className="flex flex-col items-center gap-1 rounded-[10px] border border-primary-edge bg-primary/10 px-1.5 py-2.5 text-[12.5px] text-primary-ink hover:bg-primary/20">
              <b className="text-base leading-4">{"{ }"}</b>
              Variable
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-bad">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">PNG, JPG o WebP de hasta 20 MB. Un SVG no se puede usar.</p>
        <div>
          <button type="button" onClick={() => void openLibrary()} className={smallButton} disabled={loadingLibrary}>
            <ImageIcon className="h-3.5 w-3.5" aria-hidden /> Elegir de las ya subidas
          </button>
          {loadingLibrary && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" aria-hidden />}
          {libraryError && <p className="mt-1 text-xs text-bad">{libraryError}</p>}
          {library && (
            <ul className="mt-2 grid grid-cols-4 gap-1.5" aria-label="Imágenes ya subidas">
              {library.length === 0 && <li className="col-span-4 text-xs text-muted-foreground">Todavía no subiste imágenes en este negocio.</li>}
              {library.map((img) => (
                <li key={img.path}>
                  <button type="button" aria-label="Agregar esta imagen" onClick={() => onAdd(newImageElement(format, img.path))} className="aspect-square w-full overflow-hidden rounded-md border border-border hover:border-primary-edge">
                    {/* eslint-disable-next-line @next/next/no-img-element -- link firmado de Storage */}
                    <img src={img.url} alt="" className="h-full w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className={h4}>Fondo</h3>
        <div className="flex flex-wrap items-center gap-2">
          <ColorPicker label="Color" value={bg.type === "color" ? (bg.color ?? null) : null} brandColor={brandColor} palette={palette} used={usedColors} onChange={(c) => c && onPage((p) => setBackgroundColor(p, c))} />
          <GradientControl bg={bg} brandColor={brandColor} palette={palette} used={usedColors} onChange={(g) => onPage((p) => setBackgroundGradient(p, g))} />
          <input ref={bgInput} type="file" accept={IMAGE_ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => void setBackground(e.target.files?.[0]).then(() => (e.target.value = ""))} />
          <button type="button" disabled={busy} className={smallButton} onClick={() => { clearError(); bgInput.current?.click(); }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />}
            {bg.type === "image" ? "Cambiar la imagen" : "Subir imagen de fondo"}
          </button>
          {bg.type !== "color" || bg.color ? (
            <button type="button" className={smallButton} onClick={() => onPage(removeBackground)}>
              Quitar fondo
            </button>
          ) : null}
        </div>

        {bg.type === "image" && bg.image && (
          <div className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-muted p-2.5">
            <div role="group" aria-label="Ajuste de la imagen" className="inline-flex w-fit gap-0.5 rounded-[9px] border border-border bg-background p-[3px]">
              {FIT_OPTIONS.map((o) => (
                <button key={o.value} type="button" aria-pressed={bg.image?.fit === o.value} onClick={() => onPage((p) => setBackgroundFit(p, o.value))} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", bg.image?.fit === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
                  {o.label}
                </button>
              ))}
            </div>
            {assetUrls[bg.image.asset] && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Tocá la imagen para elegir qué parte se ve (punto focal).</p>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Elegir el punto focal de la imagen"
                  className="relative w-36 cursor-crosshair overflow-hidden rounded-md border border-border"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const at = pointToPct({ x: e.clientX, y: e.clientY }, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
                    onPage((p) => setBackgroundFocal(p, at));
                  }}
                  onKeyDown={(e) => {
                    const focal = bg.image?.focal;
                    if (!focal) return;
                    const step = e.shiftKey ? 10 : 2;
                    const delta = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, -step] : e.key === "ArrowDown" ? [0, step] : null;
                    if (!delta) return;
                    e.preventDefault();
                    onPage((p) => setBackgroundFocal(p, { x: focal.x + delta[0], y: focal.y + delta[1] }));
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- link firmado de Storage */}
                  <img src={assetUrls[bg.image.asset]} alt="" draggable={false} className="block w-full" />
                  <span aria-hidden className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow" style={{ left: `${bg.image.focal.x}%`, top: `${bg.image.focal.y}%` }} />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5">
              <span className="text-xs font-semibold">Capa de color sobre la imagen</span>
              <div className="flex flex-wrap items-center gap-2">
                <ColorPicker label="Color de la capa" value={bg.overlay?.color ?? null} allowNone brandColor={brandColor} palette={["#000000", "#ffffff", ...palette]} used={usedColors} onChange={(c) => onPage((p) => (c ? setOverlay(p, { color: c, opacity: p.background.overlay?.opacity ?? DEFAULT_OVERLAY_OPACITY }) : clearOverlay(p)))} />
              </div>
              {bg.overlay && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Opacidad
                  <input type="range" min={0} max={90} value={overlayPercent(bg.overlay.opacity)} aria-label="Opacidad de la capa de color" onChange={(e) => onPage((p) => setOverlay(p, { color: p.background.overlay?.color ?? "#000000", opacity: overlayOpacityFromPercent(Number(e.target.value)) }))} className="flex-1" />
                  <input type="number" min={0} max={90} value={overlayPercent(bg.overlay.opacity)} aria-label="Opacidad de la capa, en porcentaje" onChange={(e) => e.target.value !== "" && onPage((p) => setOverlay(p, { color: p.background.overlay?.color ?? "#000000", opacity: overlayOpacityFromPercent(Number(e.target.value)) }))} className="h-7 w-14 rounded-md border border-input bg-background px-1.5 text-center text-xs" />
                  <span>%</span>
                </label>
              )}
              <p className="text-xs text-muted-foreground">{OVERLAY_HELP}</p>
            </div>
          </div>
        )}
      </section>
      <p className="text-xs text-muted-foreground">El orden de los elementos (qué queda adelante y qué atrás), ocultarlos o bloquearlos está en la pestaña <b>Capas</b>.</p>
    </div>
  );
}

function GradientControl({ bg, brandColor, palette, used, onChange }: { bg: DesignPage["background"]; brandColor: string | null; palette: readonly string[]; used: readonly string[]; onChange: (g: { from: string; to: string; angle: number }) => void }) {
  const g = bg.type === "gradient" && bg.gradient ? bg.gradient : { from: "#111111", to: "#4f46e5", angle: 135 };
  return (
    <span className="flex items-center gap-1.5">
      <ColorPicker label="Degradé de" value={g.from} brandColor={brandColor} palette={palette} used={used} onChange={(c) => c && onChange({ ...g, from: c })} />
      <ColorPicker label="a" value={g.to} brandColor={brandColor} palette={palette} used={used} onChange={(c) => c && onChange({ ...g, to: c })} />
      {bg.type === "gradient" && <input type="number" aria-label="Ángulo del degradé" min={-360} max={360} value={g.angle} onChange={(e) => e.target.value !== "" && onChange({ ...g, angle: Number(e.target.value) })} className="h-7 w-14 rounded-md border border-input bg-background px-1.5 text-xs" />}
    </span>
  );
}
