"use client";

/**
 * Botón «Usar en contenido» / «En contenido ▾» de la barra del editor (DS8, F63).
 *
 * Sin vincular: el botón abre un modal con dos caminos: «Crear una pieza nueva» (título, redes con su formato y «Que el
 * copywriter proponga el caption») o «Vincular a una pieza existente» (buscador de piezas y la red donde va). Al confirmar
 * se vincula y se encola `design_content_sync`: los archivos llegan a la biblioteca de la pieza y quedan elegidos en orden
 * en la red. Ya vinculado, el botón pasa a «En contenido ▾»: la pieza (estado y redes), Abrir la pieza, Enviar los cambios
 * a la pieza y Desvincular (los archivos que ya estaban quedan en la pieza).
 *
 * Todo lo que decide sale de `lib/designer/screens/use-in-content.ts` (puro, con su test); las acciones validan el
 * permiso adentro. Las props son el contrato (`lib/designer/contracts.ts`).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Popover } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { loadContentLink, loadUseInContent, searchPieces, syncToPiece, unlinkFromPiece, useInContent as linkDesignToContent } from "@/lib/actions/designer/content";
import type { ContentLinkInfo, PieceChoice, UseInContentModalData } from "@/lib/designer/content-link-types";
import type { UseInContentProps } from "@/lib/designer/contracts";
import {
  USE_IN_CONTENT_TEXT as T,
  buildSubmission,
  exportSummary,
  initialModalState,
  linkNetworkOptions,
  linkedMenuView,
  networkKey,
  resolveLinkPlatform,
  syncMessage,
  toggleNetwork,
  type ModalState,
} from "@/lib/designer/screens/use-in-content";
import { cn } from "@/lib/utils";
import { DesignerDialog, inputClass, primaryButton, secondaryButton } from "../editor/overlays";

const itemClass = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const STATE_TONE: Record<string, string> = {
  none: "bg-muted text-muted-foreground",
  tent: "bg-warn/15 text-warn",
  sched: "bg-primary/15 text-primary-ink",
  pub: "bg-good/15 text-good",
  fail: "bg-bad/15 text-bad",
};

export function UseInContent(props: UseInContentProps) {
  const router = useRouter();
  // Lo que acaba de pasar acá se ve en el momento; cuando el servidor manda otra cosa (después de `router.refresh()`), se toma.
  const [linkedPostId, setLinkedPostId] = useState(props.linkedPostId);
  const [seen, setSeen] = useState(props.linkedPostId);
  if (seen !== props.linkedPostId) {
    setSeen(props.linkedPostId);
    setLinkedPostId(props.linkedPostId);
  }
  const [open, setOpen] = useState(false);

  if (linkedPostId) {
    return (
      <LinkedMenu
        designId={props.designId}
        onUnlinked={() => {
          setLinkedPostId(null);
          router.refresh();
        }}
      />
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={secondaryButton}>
        <Pencil className="h-4 w-4" aria-hidden /> {T.button}
      </button>
      {open && (
        <UseInContentModal
          designId={props.designId}
          onClose={() => setOpen(false)}
          onLinked={(postId) => {
            setLinkedPostId(postId);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// ─── El menú «En contenido ▾» ────────────────────────────────────────────────

function LinkedMenu({ designId, onUnlinked }: { designId: string; onUnlinked: () => void }) {
  const [info, setInfo] = useState<ContentLinkInfo | null | undefined>(undefined);
  const [notice, setNotice] = useState<{ tone: "ok" | "info" | "error"; text: string; href?: string } | null>(null);
  const [busy, setBusy] = useState<null | "sync" | "unlink">(null);
  const [confirming, setConfirming] = useState(false);

  async function load() {
    const result = await loadContentLink({ designId });
    setInfo(result.ok ? result.data : null);
  }

  useEffect(() => {
    let alive = true;
    void loadContentLink({ designId }).then((result) => {
      if (alive) setInfo(result.ok ? result.data : null);
    });
    return () => {
      alive = false;
    };
  }, [designId]);

  const view = linkedMenuView(info ?? null);

  async function send() {
    setBusy("sync");
    setNotice(null);
    try {
      const result = await syncToPiece({ designId });
      if (!result.ok) setNotice({ tone: "error", text: result.error });
      else {
        const message = syncMessage(result.data);
        setNotice({ tone: message.tone, text: message.text, ...(message.openPiece && result.data.href ? { href: result.data.href } : {}) });
        await load();
      }
    } catch {
      setNotice({ tone: "error", text: "No se pudo enviar. Revisá tu conexión y probá de nuevo." });
    } finally {
      setBusy(null);
    }
  }

  async function unlink() {
    setConfirming(false);
    setBusy("unlink");
    setNotice(null);
    try {
      const result = await unlinkFromPiece({ designId });
      if (result.ok) onUnlinked();
      else setNotice({ tone: "error", text: result.error });
    } catch {
      setNotice({ tone: "error", text: "No se pudo desvincular. Revisá tu conexión y probá de nuevo." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Popover label="En contenido" align="end" panelClassName="w-[min(22rem,calc(100vw-1.5rem))] p-3" triggerClassName={secondaryButton} trigger={<><Pencil className="h-4 w-4" aria-hidden /> {T.buttonLinked}</>}>
        <div className="flex flex-col gap-2">
          <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">En contenido</h3>
          {info === undefined && <p className="px-2 text-xs text-muted-foreground">Cargando la pieza…</p>}
          {info === null && <p className="px-2 text-xs text-muted-foreground">La pieza vinculada ya no está disponible. Podés desvincular este diseño.</p>}
          {view && info && (
            <div className="mx-1 rounded-lg bg-muted p-2.5 text-xs">
              <p className="font-semibold text-foreground">{view.title}</p>
              <p className="mt-0.5 text-muted-foreground">{info.statusLabel}</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {view.networks.map((n) => (
                  <li key={n.platform} className="flex items-center justify-between gap-2">
                    <span>{n.label}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATE_TONE[n.state] ?? STATE_TONE.none)}>{n.stateLabel}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {info && (
            <Link href={info.href} className={itemClass}>
              {T.openPiece}
            </Link>
          )}
          <button type="button" onClick={() => void send()} disabled={busy !== null || info === null} className={itemClass}>
            {busy === "sync" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {T.sendChanges}
          </button>
          <div className="border-t border-border pt-2">
            <button type="button" onClick={() => setConfirming(true)} disabled={busy !== null} className={cn(itemClass, "text-bad")}>
              {busy === "unlink" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {T.unlink}
            </button>
          </div>
          {notice && (
            <p role={notice.tone === "error" ? "alert" : "status"} className={cn("px-2 text-xs", notice.tone === "error" ? "text-bad" : "text-muted-foreground")}>
              {notice.text}{" "}
              {notice.href && (
                <Link href={notice.href} className="font-medium text-primary-ink underline underline-offset-2">
                  {T.openPiece}
                </Link>
              )}
            </p>
          )}
        </div>
      </Popover>
      <ConfirmDialog open={confirming} title={T.unlinkTitle} message={T.unlinkMessage} confirmLabel={T.unlink} cancelLabel="Cancelar" destructive onConfirm={() => void unlink()} onCancel={() => setConfirming(false)} />
    </>
  );
}

// ─── El modal ────────────────────────────────────────────────────────────────

type Loaded = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: UseInContentModalData };

function UseInContentModal({ designId, onClose, onLinked }: { designId: string; onClose: () => void; onLinked: (postId: string) => void }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    void loadUseInContent({ designId })
      .then((result) => {
        if (alive) setLoaded(result.ok ? { status: "ready", data: result.data } : { status: "error", message: result.error });
      })
      .catch(() => {
        if (alive) setLoaded({ status: "error", message: "No se pudo cargar. Revisá tu conexión y probá de nuevo." });
      });
    return () => {
      alive = false;
    };
  }, [designId, attempt]);

  if (loaded.status !== "ready") {
    return (
      <DesignerDialog title={T.title} label={T.title} onClose={onClose} footer={<button type="button" onClick={onClose} className={secondaryButton}>Cerrar</button>}>
        {loaded.status === "loading" ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando…
          </p>
        ) : (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-bad">{loaded.message}</p>
            <button
              type="button"
              onClick={() => {
                setLoaded({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
              className={secondaryButton}
            >
              Probar de nuevo
            </button>
          </div>
        )}
      </DesignerDialog>
    );
  }

  return <ModalBody designId={designId} data={loaded.data} onClose={onClose} onLinked={onLinked} />;
}

function ModalBody({ designId, data, onClose, onLinked }: { designId: string; data: UseInContentModalData; onClose: () => void; onLinked: (postId: string) => void }) {
  const [state, setState] = useState<ModalState>(() => initialModalState(data));
  const [pieces, setPieces] = useState<PieceChoice[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ postId: string; href: string; notice?: string } | null>(null);

  const patch = (change: Partial<ModalState>) => setState((s) => ({ ...s, ...change }));

  // Las piezas se buscan al abrir «Vincular» y cuando se deja de escribir (sin pedir una por tecla).
  useEffect(() => {
    if (state.mode !== "link") return;
    let alive = true;
    const timer = setTimeout(
      () => {
        void searchPieces({ query: state.query })
          .then((result) => {
            if (!alive) return;
            if (result.ok) {
              setPieces(result.data);
              setSearchError(null);
            } else setSearchError(result.error);
          })
          .catch(() => alive && setSearchError("No se pudo buscar. Revisá tu conexión y probá de nuevo."));
      },
      pieces === null ? 0 : 250,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // `pieces` solo decide si espera: no tiene que volver a disparar la búsqueda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode, state.query]);

  const submission = buildSubmission(designId, state, data, pieces ?? []);
  const chosen = pieces?.find((p) => p.id === state.pieceId) ?? null;
  const platformOptions = linkNetworkOptions(chosen, data);
  const platform = resolveLinkPlatform(state, platformOptions);
  const chosenOption = platformOptions.find((o) => o.platform === platform) ?? null;

  async function confirm() {
    if (!submission.ok) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await linkDesignToContent(submission.input);
      if (result.ok) {
        setDone(result.data);
        onLinked(result.data.postId);
      } else setError(result.error);
    } catch {
      setError("No se pudo completar. Revisá tu conexión y probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <DesignerDialog
        title={T.title}
        label={T.title}
        onClose={onClose}
        footer={
          <>
            <button type="button" onClick={onClose} className={secondaryButton}>Cerrar</button>
            <Link href={done.href} className={primaryButton}>{T.openPiece}</Link>
          </>
        }
      >
        <p role="status" className="text-sm">
          {state.mode === "new" ? "Listo: la pieza se creó en Borrador." : "Listo: el diseño quedó vinculado a la pieza."} Los archivos del diseño se preparan y aparecen en la pieza en un momento.
        </p>
        {done.notice && <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">{done.notice}</p>}
      </DesignerDialog>
    );
  }

  return (
    <DesignerDialog
      title={T.title}
      label={T.title}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p role="alert" className="mr-auto text-xs text-bad">
              {error}
            </p>
          )}
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancelar
          </button>
          <button type="button" onClick={() => void confirm()} disabled={!submission.ok || submitting} title={submission.ok ? undefined : submission.reason} className={primaryButton}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {state.mode === "new" ? T.create : T.link}
          </button>
        </>
      }
    >
      <div role="group" aria-label="Qué querés hacer" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(["new", "link"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={state.mode === mode}
            onClick={() => patch({ mode })}
            className={cn("h-8 rounded-md px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", state.mode === mode ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {mode === "new" ? T.modeNew : T.modeLink}
          </button>
        ))}
      </div>

      {state.mode === "new" ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="uic-title" className="text-xs font-medium text-muted-foreground">
              {T.titleLabel}
            </label>
            <input id="uic-title" value={state.title} maxLength={200} onChange={(e) => patch({ title: e.target.value })} className={inputClass} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">{T.networks}</legend>
            {data.networks.map((n) => {
              const checked = state.selected.includes(networkKey(n));
              return (
                <div key={networkKey(n)}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={checked} onChange={() => patch({ selected: toggleNetwork(state.selected, n) })} className="h-4 w-4 accent-[var(--primary)]" />
                    {n.label}
                  </label>
                  {checked && n.note && <p className="ml-6 mt-0.5 text-xs text-muted-foreground">{n.note}</p>}
                  {checked && n.fit.message && <p className="ml-6 mt-0.5 text-xs text-warn">{n.fit.message}</p>}
                </div>
              );
            })}
          </fieldset>
          {data.canCopy && (
            <div className="flex items-center gap-2 text-sm">
              <Switch checked={state.proposeCaption} onChange={(value) => patch({ proposeCaption: value })} label={T.captionLabel} size="sm" />
              <span>{T.captionHelp}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{T.draftHelp}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="uic-search" className="text-xs font-medium text-muted-foreground">
              {T.searchLabel}
            </label>
            <input id="uic-search" type="search" value={state.query} onChange={(e) => patch({ query: e.target.value })} placeholder={T.searchLabel} className={inputClass} />
          </div>
          {searchError && <p role="alert" className="text-xs text-bad">{searchError}</p>}
          {pieces === null && !searchError && <p role="status" className="text-xs text-muted-foreground">Buscando…</p>}
          {pieces !== null && pieces.length === 0 && <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">{T.noPieces}</p>}
          {pieces !== null && pieces.length > 0 && (
            <div role="radiogroup" aria-label="Piezas" className="max-h-60 space-y-1.5 overflow-y-auto">
              {pieces.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={state.pieceId === p.id}
                  onClick={() => patch({ pieceId: p.id, platform: null })}
                  className={cn("flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", state.pieceId === p.id ? "border-primary-edge bg-primary/5" : "border-border hover:bg-accent")}
                >
                  <span aria-hidden className={cn("mt-1 h-3.5 w-3.5 shrink-0 rounded-full border", state.pieceId === p.id ? "border-primary-edge bg-primary" : "border-border")} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.summary}
                      {p.hasDesign ? ` · ${T.alreadyHasDesign}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {chosen && (
            <div className="space-y-1.5">
              <label htmlFor="uic-network" className="text-xs font-medium text-muted-foreground">
                {T.networkLabel}
              </label>
              {platformOptions.length === 0 ? (
                <p className="text-xs text-warn">Este diseño no sirve para ninguna red de esa pieza.</p>
              ) : (
                <select id="uic-network" value={platform ?? ""} onChange={(e) => patch({ platform: e.target.value })} className={inputClass}>
                  {platformOptions.map((o) => (
                    <option key={o.platform} value={o.platform}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        <p>{exportSummary(data, state.mode === "new" ? state.selected : chosenOption ? [networkKey(chosenOption)] : [])}</p>
        <p>{T.linkNote}</p>
      </div>
    </DesignerDialog>
  );
}
