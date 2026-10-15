"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Link2 } from "lucide-react";
import { attributionCodeHint } from "@/lib/attribution/code-hint";
import { composePieceLink, PIECE_LINK_PLATFORMS } from "@/lib/attribution/piece-link";

/**
 * El código de atribución de la pieza y el generador de links (Extra I, F38 y F42).
 *
 * Es de solo lectura: el código lo completa la base al crear la pieza. Sirve para que un link que se pone en una bio, un
 * comentario fijado o un post lleve `utm_content=<código>` y la visita quede atribuida a la pieza.
 *
 * El generador es un panel que se despliega acá mismo (no un modal): el drawer ya atrapa el foco y cierra con Esc, y un modal
 * encima se pelearía con eso. Arma el link mientras se escribe; no hay botón de "generar".
 */

/** Copia un texto y avisa un instante («Copiado»). Si el navegador no deja copiar, lo dice. */
function useCopy() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return { state, copy };
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { state, copy } = useCopy();
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void copy(text)}
        aria-label={label}
        className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {state === "copied" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        Copiar
      </button>
      <span role="status" aria-live="polite" className="text-[11px] text-muted-foreground">
        {state === "copied" ? "Copiado" : state === "failed" ? "No pude copiar. Seleccionalo a mano." : ""}
      </span>
    </span>
  );
}

export function PieceAttribution({ code, pieceTitle }: { code: string | null; pieceTitle: string }) {
  const hint = attributionCodeHint(code);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!hint) return null;

  return (
    <section aria-label="Atribución de la pieza" className="space-y-1.5 rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="min-w-0 text-xs">
          <span className="text-muted-foreground">Código de atribución: </span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold" data-testid="attribution-code">
            {hint.code}
          </code>
        </p>
        <CopyButton text={hint.code} label="Copiar el código de atribución" />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Usalo en tus links: <code className="break-all rounded bg-muted px-1 py-0.5 font-mono">{hint.param}</code>
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
        <Link2 className="h-3.5 w-3.5" aria-hidden />
        Armar un link
      </button>

      {open && (
        <div id={panelId}>
          <LinkBuilder code={hint.code} pieceTitle={pieceTitle} />
        </div>
      )}
    </section>
  );
}

function LinkBuilder({ code, pieceTitle }: { code: string; pieceTitle: string }) {
  const urlId = useId();
  const platformId = useId();
  const errorId = useId();
  const [url, setUrl] = useState("");
  const [platform, setPlatform] = useState<string>(PIECE_LINK_PLATFORMS[0].value);

  const typed = url.trim() !== "";
  const result = composePieceLink({ url, platform, pieceTitle, contentCode: code });
  const error = typed && !result.ok ? result.error : null;

  return (
    <div className="mt-1 space-y-2 rounded-lg bg-muted p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <label htmlFor={urlId} className="mb-1 block text-xs font-medium">
            Link de destino
          </label>
          <input
            id={urlId}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://tu-sitio.com/programa"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor={platformId} className="mb-1 block text-xs font-medium">
            Red
          </label>
          <select
            id={platformId}
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm sm:w-auto"
          >
            {PIECE_LINK_PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {typed && result.ok && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Tu link</p>
          <p className="break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs" data-testid="piece-link">
            {result.url}
          </p>
          {result.unchanged && (
            <p className="text-[11px] text-muted-foreground">Este link ya traía todos los parámetros, así que quedó igual.</p>
          )}
          <CopyButton text={result.url} label="Copiar el link armado" />
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Es un link sin seguimiento: como no hay un contacto, solo agrega los parámetros y no registra el clic.
      </p>
    </div>
  );
}
