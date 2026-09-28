"use client";

/**
 * El generador de código de embed (F40).
 *
 * Tres modos (en la página, ventana, botón flotante), las opciones que se
 * pueden tocar y el código listo para copiar, en HTML y en React. La vista
 * previa es el MISMO iframe que verá el visitante, así lo que se ve acá es lo
 * que va a quedar.
 */

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { EMBED_MODE_LABELS, generateEmbedCode, type EmbedMode } from "@/lib/embed/code";
import { buildEmbedIframeUrl } from "@/lib/embed/url";
import { BOOKER_THEMES, type BookerTheme } from "@/lib/scheduling/booker/embed-params";
import type { FallbackPayload } from "@/lib/scheduling/booker/unavailable-defaults";

const MODES: EmbedMode[] = ["inline", "popup", "floating"];
const THEME_LABELS: Record<BookerTheme, string> = { auto: "Como el sitio", light: "Claro", dark: "Oscuro" };

const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

export function EmbedGenerator({
  calLink,
  baseUrl,
  fallback,
  eventTitle,
}: {
  /** `usuario/evento`. */
  calLink: string;
  baseUrl: string;
  fallback: FallbackPayload;
  eventTitle: string;
}) {
  const [mode, setMode] = useState<EmbedMode>("inline");
  const [theme, setTheme] = useState<BookerTheme>("auto");
  const [color, setColor] = useState("");
  const [hideDetails, setHideDetails] = useState(false);
  const [buttonText, setButtonText] = useState("Agendar una llamada");
  const [language, setLanguage] = useState<"html" | "react">("html");
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    try {
      return generateEmbedCode(mode, { calLink, theme, color: color || null, hideEventTypeDetails: hideDetails, buttonText, fallback }, baseUrl);
    } catch {
      return { html: "", react: "" };
    }
  }, [baseUrl, buttonText, calLink, color, fallback, hideDetails, mode, theme]);

  const previewUrl = useMemo(() => {
    try {
      return buildEmbedIframeUrl(calLink, { theme, color: color || null, hideEventTypeDetails: hideDetails }, {}, baseUrl);
    } catch {
      return null;
    }
  }, [baseUrl, calLink, color, hideDetails, theme]);

  const text = language === "html" ? code.html : code.react;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Modo del embed">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={mode === m ? "flex-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground" : "flex-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"}
            >
              {EMBED_MODE_LABELS[m]}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <label htmlFor="emb-theme" className="text-sm font-medium">
            Tema
          </label>
          <select id="emb-theme" value={theme} onChange={(e) => setTheme(e.target.value as BookerTheme)} className={inputClass}>
            {BOOKER_THEMES.map((t) => (
              <option key={t} value={t}>
                {THEME_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="emb-color" className="text-sm font-medium">
            Color principal
          </label>
          <div className="flex gap-2">
            <input id="emb-color" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#6366f1" className={inputClass} />
            <input
              type="color"
              aria-label="Elegir color"
              value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#6366f1"}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 shrink-0 rounded-lg border border-input bg-background"
            />
          </div>
          <p className="text-xs text-muted-foreground">Vacío = el color del evento.</p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hideDetails} onChange={(e) => setHideDetails(e.target.checked)} className="h-4 w-4" />
          Ocultar los datos del evento (ya los muestra tu página)
        </label>

        {mode !== "inline" && (
          <div className="space-y-1">
            <label htmlFor="emb-button" className="text-sm font-medium">
              Texto del botón
            </label>
            <input id="emb-button" value={buttonText} onChange={(e) => setButtonText(e.target.value)} className={inputClass} />
          </div>
        )}

        <div className="rounded-xl border border-border">
          <div className="flex items-center gap-2 border-b border-border p-2">
            <div className="flex rounded-md border border-border p-0.5">
              {(["html", "react"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={language === l}
                  onClick={() => setLanguage(l)}
                  className={language === l ? "rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground" : "rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"}
                >
                  {l === "html" ? "HTML" : "React"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted"
            >
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
          <pre className="max-h-72 overflow-auto p-3 text-[11px] leading-relaxed">
            <code>{text}</code>
          </pre>
        </div>

        <p className="text-xs text-muted-foreground">
          Pegalo donde quieras que aparezca. Si el calendario no cargara, la página muestra el mensaje de respaldo que configuraste en &quot;Si no se puede
          agendar&quot; y un link para abrirlo en otra pestaña.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Vista previa</p>
        {previewUrl ? (
          <iframe
            key={previewUrl}
            src={previewUrl}
            title={`Vista previa de ${eventTitle}`}
            className="h-[640px] w-full rounded-xl border border-border"
          />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Para ver la vista previa hace falta el usuario de tu agenda.
          </p>
        )}
      </div>
    </div>
  );
}
