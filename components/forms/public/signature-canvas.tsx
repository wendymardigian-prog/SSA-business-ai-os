"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { countStrokes, toCanvasPoint, type Stroke } from "@/lib/forms/contract/signature-input";

/**
 * El lienzo de la firma (F25). Portado de `SignatureCanvas.tsx` de prevxcrm, sin
 * dependencias: mouse y dedo con `pointer events` y `touch-action: none` (para que
 * firmar no desplace la página), fondo blanco, trazo negro, ancho al 100 % del
 * contenedor y alto fijo de 180 px. Exporta un PNG.
 *
 * Avisa con `onChange(dataUrl, trazos)`: `null` cuando no hay nada dibujado.
 */

const WIDTH = 780; // el doble del ancho usable en un teléfono (390): sale nítido en pantallas densas
const HEIGHT = 180;

export function SignatureCanvas({
  onChange,
  disabled = false,
  invalid = false,
}: {
  onChange: (dataUrl: string | null, strokes: number) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef(false);
  const [drawn, setDrawn] = useState(false);

  const paintBackground = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    paintBackground();
  }, [paintBackground]);

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    return toCanvasPoint({ x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect(), { width: WIDTH, height: HEIGHT });
  };

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = pointOf(event);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    strokes.current.push([point]);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    event.preventDefault();
    const point = pointOf(event);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    strokes.current[strokes.current.length - 1]?.push(point);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const count = countStrokes(strokes.current);
    if (count === 0) {
      // Un toque suelto no es una firma: se descarta.
      strokes.current = [];
      paintBackground();
      setDrawn(false);
      onChange(null, 0);
      return;
    }
    setDrawn(true);
    onChange(canvasRef.current?.toDataURL("image/png") ?? null, count);
  }

  function clear() {
    strokes.current = [];
    drawing.current = false;
    paintBackground();
    setDrawn(false);
    onChange(null, 0);
  }

  return (
    <div className="space-y-2">
      <div className={`relative overflow-hidden rounded-lg border bg-white ${invalid ? "border-destructive" : "border-border"}`}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          aria-label="Recuadro para dibujar tu firma con el mouse o el dedo"
          className="block h-[180px] w-full cursor-crosshair"
          style={{ touchAction: "none" }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
        {!drawn && !disabled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-neutral-400">Dibujá tu firma acá</p>
          </div>
        )}
      </div>
      {drawn && (
        <button type="button" onClick={clear} disabled={disabled} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
          <Eraser className="h-3.5 w-3.5" aria-hidden /> Borrar
        </button>
      )}
    </div>
  );
}
