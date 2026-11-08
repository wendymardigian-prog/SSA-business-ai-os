"use client";

import { useState } from "react";
import { Popover } from "@/components/ui/popover";
import { colorChoices, isColor, normalizeHexInput } from "@/lib/designer/color";
import { cn } from "@/lib/utils";

/**
 * El selector de colores (F12): los de la marca, los usados en el diseño y uno libre (selector del navegador + campo
 * hex). `allowNone` suma «Sin color» (el relleno de una forma, el resaltado de un texto).
 */
export function ColorPicker({
  label,
  value,
  onChange,
  brandColor,
  palette,
  used,
  allowNone = false,
  triggerClassName,
}: {
  label: string;
  value: string | null;
  onChange: (color: string | null) => void;
  brandColor: string | null;
  palette: readonly string[];
  used: readonly string[];
  allowNone?: boolean;
  triggerClassName?: string;
}) {
  const choices = colorChoices({ brandColor, palette, used });
  const [hex, setHex] = useState(value ?? "");
  const current = value && isColor(value) ? value.slice(0, 7) : null;

  const Swatch = ({ color }: { color: string }) => (
    <button
      type="button"
      aria-label={`Color ${color}`}
      title={color}
      aria-pressed={current?.toLowerCase() === color.slice(0, 7).toLowerCase()}
      onClick={() => {
        onChange(color);
        setHex(color);
      }}
      className={cn("h-6 w-6 rounded-full border border-border", current?.toLowerCase() === color.slice(0, 7).toLowerCase() && "ring-2 ring-primary-edge ring-offset-1 ring-offset-popover")}
      style={{ background: color }}
    />
  );

  return (
    <Popover
      label={label}
      align="start"
      panelClassName="w-64 p-3"
      triggerClassName={cn("flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-1.5 hover:bg-accent", triggerClassName)}
      trigger={
        <>
          <span className="h-4 w-4 rounded-full border border-border" style={{ background: current ?? "transparent", backgroundImage: current ? undefined : "linear-gradient(135deg, transparent 45%, #ef4444 45% 55%, transparent 55%)" }} aria-hidden />
          <span className="text-xs">{label}</span>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {choices.brand.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">De la marca</p>
            <div className="flex flex-wrap gap-1.5">
              {choices.brand.map((c) => (
                <Swatch key={c} color={c} />
              ))}
            </div>
          </div>
        )}
        {choices.used.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Usados en el diseño</p>
            <div className="flex flex-wrap gap-1.5">
              {choices.used.map((c) => (
                <Swatch key={c} color={c} />
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Otro color</p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Elegir un color"
              value={current ?? "#000000"}
              onChange={(e) => {
                onChange(e.target.value);
                setHex(e.target.value);
              }}
              className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
            <input
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                const normalized = normalizeHexInput(e.target.value);
                if (normalized) onChange(normalized);
              }}
              aria-label="Color en hexadecimal"
              placeholder="#112233"
              maxLength={7}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs font-mono"
            />
          </div>
        </div>
        {allowNone && (
          <button type="button" onClick={() => onChange(null)} className="h-7 rounded-md border border-border text-xs hover:bg-accent">
            Sin color
          </button>
        )}
      </div>
    </Popover>
  );
}
