"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Link2 } from "lucide-react";
import { attributionCodeHint } from "@/lib/attribution/code-hint";
import { composePieceLink, PIECE_LINK_PLATFORMS } from "@/lib/attribution/piece-link";
import {
  CUSTOM_DESTINATION,
  destinationHint,
  destinationKey,
  destinationUrl,
  selectedDestination,
  type PieceLinkDestinations,
} from "@/lib/attribution/piece-link-destinations";
import { loadPieceLinkDestinations } from "@/lib/actions/piece-link-destinations";

/**
 * El código de atribución de la pieza y el generador de links (Extra I, F38 y F42).
 *
 * Es de solo lectura: el código lo completa la base al crear la pieza. Sirve para que un link que se pone en una bio, un
 * comentario fijado o un post lleve `utm_content=<código>` y la visita quede atribuida a la pieza.
 *
 * El generador es un panel que se despliega acá mismo (no un modal): el drawer ya atrapa el foco y cierra con Esc, y un modal
 * encima se pelearía con eso. Arma el link mientras se escribe; no hay botón de "generar".
 *
 * El destino se pega a mano o se elige de los formularios publicados y las agendas del negocio (7/11/2026). La lista se
 * pide al abrir el panel; qué entra y qué dice el aviso de abajo lo decide `lib/attribution/piece-link-destinations.ts`.
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
        className="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

type DestinationsState =
  | { status: "loading" }
  | { status: "ready"; destinations: PieceLinkDestinations }
  | { status: "failed"; error: string };

/**
 * Los formularios y las agendas del negocio, pedidos al abrir el panel (no con el drawer). Si la pieza se cierra antes
 * de que lleguen, no se escriben.
 */
function useDestinations(): DestinationsState {
  const [state, setState] = useState<DestinationsState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    loadPieceLinkDestinations()
      .then((res) => {
        if (!alive) return;
        setState(res.ok ? { status: "ready", destinations: res.destinations } : { status: "failed", error: res.error });
      })
      .catch(() => {
        if (alive) setState({ status: "failed", error: "No pude cargar tus formularios y agendas. Podés pegar el link a mano." });
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

function LinkBuilder({ code, pieceTitle }: { code: string; pieceTitle: string }) {
  const urlId = useId();
  const destinationId = useId();
  const platformId = useId();
  const errorId = useId();
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<string>(CUSTOM_DESTINATION);
  const [platform, setPlatform] = useState<string>(PIECE_LINK_PLATFORMS[0].value);
  const loaded = useDestinations();

  const destinations = loaded.status === "ready" ? loaded.destinations : null;
  const hasOptions = destinations !== null && destinations.forms.length + destinations.events.length > 0;
  // Sin nada para elegir, el desplegable ni aparece: queda el campo, como siempre.
  const showPicker = loaded.status === "loading" || hasOptions;
  const destination = selectedDestination(selected, destinations);
  const target = destinationUrl(destination, url);

  const typed = target.trim() !== "";
  const result = composePieceLink({ url: target, platform, pieceTitle, contentCode: code });
  const error = typed && !result.ok ? result.error : null;

  return (
    <div className="mt-1 space-y-2 rounded-lg bg-muted p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-2">
          {showPicker && (
            <div>
              <label htmlFor={destinationId} className="mb-1 block text-xs font-medium">
                Destino
              </label>
              <select
                id={destinationId}
                value={destination ? selected : CUSTOM_DESTINATION}
                onChange={(e) => setSelected(e.target.value)}
                disabled={loaded.status === "loading"}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
              >
                <option value={CUSTOM_DESTINATION}>{loaded.status === "loading" ? "Cargando…" : "Otro link (lo pego yo)"}</option>
                {destinations && destinations.forms.length > 0 && (
                  <optgroup label="Formularios">
                    {destinations.forms.map((d) => (
                      <option key={destinationKey(d)} value={destinationKey(d)}>
                        {d.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {destinations && destinations.events.length > 0 && (
                  <optgroup label="Agendas">
                    {destinations.events.map((d) => (
                      <option key={destinationKey(d)} value={destinationKey(d)}>
                        {d.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          {!destination && (
            <div>
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
          )}
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

      {loaded.status === "failed" && <p className="text-[11px] text-muted-foreground">{loaded.error}</p>}

      <p className={destination?.noContact ? "text-[11px] text-amber-700 dark:text-amber-400" : "text-[11px] text-muted-foreground"}>
        {destinationHint(destination)}
      </p>
    </div>
  );
}
