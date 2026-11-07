"use client";

/**
 * Menú Publicar / ● Publicado de la barra del editor (F45, F47).
 *
 * Sin publicar: el link, «Permitir descargar» (en una página web, «Permitir que aparezca en buscadores») y
 * «Publicar ahora». Publicado: copiar el link, verlo como lo ve el público, las mismas opciones, «Anular…» si es
 * una pieza con verificación válida (pide el motivo) y «Despublicar» (el link deja de funcionar; el código se
 * conserva). Lo que el permiso no da se oculta. Las decisiones salen de `publishMenuView` (puro, con su test).
 *
 * El link llega armado del servidor con el dominio del negocio (`links`): acá nunca se arma con el del navegador.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Popover } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { publishDesign, setPublicOptions, unpublishDesign, voidDesign } from "@/lib/actions/designer/publish";
import type { PublishMenuProps } from "@/lib/designer/contracts";
import { publishMenuView, voidReasonProblem } from "@/lib/designer/screens/publish-menu";
import { MAX_VOID_REASON } from "@/lib/designer/publishing-limits";

type Notice = { tone: "ok" | "error"; text: string } | null;
type Busy = null | "publish" | "unpublish" | "options" | "void";

const itemClass = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function PublishMenu(props: PublishMenuProps) {
  const router = useRouter();
  const [published, setPublished] = useState(props.published);
  const [allowDownload, setAllowDownload] = useState(props.allowDownload);
  const [allowIndexing, setAllowIndexing] = useState(props.allowIndexing);
  const [link, setLink] = useState<string | null>(props.links?.link ?? null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [mode, setMode] = useState<"menu" | "void">("menu");
  const [reason, setReason] = useState("");
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [voidedLocally, setVoidedLocally] = useState(false);

  // Cuando el servidor manda valores nuevos (después de un `router.refresh()`), se toman.
  const [seen, setSeen] = useState({ published: props.published, allowDownload: props.allowDownload, allowIndexing: props.allowIndexing, link: props.links?.link ?? null, status: props.verification?.status ?? null });
  const incoming = { published: props.published, allowDownload: props.allowDownload, allowIndexing: props.allowIndexing, link: props.links?.link ?? null, status: props.verification?.status ?? null };
  if (JSON.stringify(seen) !== JSON.stringify(incoming)) {
    setSeen(incoming);
    setPublished(incoming.published);
    setAllowDownload(incoming.allowDownload);
    setAllowIndexing(incoming.allowIndexing);
    setLink(incoming.link);
    setVoidedLocally(false);
  }

  const verification = props.verification && voidedLocally ? { ...props.verification, status: "void" as const } : props.verification;
  const view = publishMenuView({ format: props.format, can: props.can, verification }, { published, link });
  if (!view.visible) return null;

  async function run(kind: Busy, work: () => Promise<{ ok: boolean; error?: string }>, onOk: () => void) {
    setBusy(kind);
    setNotice(null);
    try {
      const result = await work();
      if (result.ok) onOk();
      else setNotice({ tone: "error", text: result.error ?? "No se pudo completar. Probá de nuevo." });
    } catch {
      setNotice({ tone: "error", text: "No se pudo completar. Revisá tu conexión y probá de nuevo." });
    } finally {
      setBusy(null);
    }
  }

  const publishNow = () =>
    run(
      "publish",
      async () => {
        const result = await publishDesign({ designId: props.designId, allowDownload, allowIndexing: props.format === "web" ? allowIndexing : undefined });
        if (result.ok) setLink(result.data.link);
        return result;
      },
      () => {
        setPublished(true);
        setNotice({ tone: "ok", text: "Publicado: el link ya funciona." });
        router.refresh();
      },
    );

  const unpublish = () =>
    run(
      "unpublish",
      () => unpublishDesign({ designId: props.designId }),
      () => {
        setPublished(false);
        setNotice({ tone: "ok", text: "Despublicado: el link dejó de funcionar." });
        router.refresh();
      },
    );

  /** Un interruptor: si ya está publicado se guarda en el momento (y vuelve atrás si falla); si no, espera a «Publicar ahora». */
  function toggle(field: "download" | "indexing", value: boolean) {
    const previous = field === "download" ? allowDownload : allowIndexing;
    if (field === "download") setAllowDownload(value);
    else setAllowIndexing(value);
    if (!published) return;
    void run(
      "options",
      async () => {
        const result = await setPublicOptions({ designId: props.designId, ...(field === "download" ? { allowDownload: value } : { allowIndexing: value }) });
        if (!result.ok) {
          if (field === "download") setAllowDownload(previous);
          else setAllowIndexing(previous);
        }
        return result;
      },
      () => router.refresh(),
    );
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setNotice({ tone: "ok", text: "Link copiado." });
    } catch {
      setNotice({ tone: "error", text: "No se pudo copiar. Seleccioná el link y copialo a mano." });
    }
  }

  const reasonProblem = voidReasonProblem(reason);
  const confirmVoid = () =>
    run(
      "void",
      () => voidDesign({ designId: props.designId, reason: reason.trim() }),
      () => {
        setVoidedLocally(true);
        setMode("menu");
        setReason("");
        setNotice({ tone: "ok", text: "Anulado: el link muestra el motivo." });
        router.refresh();
      },
    );

  return (
    <>
      <Popover
        label={view.trigger.published ? "Publicado" : "Publicar"}
        align="end"
        panelClassName="w-[min(22rem,calc(100vw-1.5rem))] p-3"
        triggerClassName={
          view.trigger.published
            ? "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            : "inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        }
        trigger={
          view.trigger.published ? (
            <>
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />
              Publicado ▾
            </>
          ) : (
            "Publicar"
          )
        }
      >
        {mode === "void" && view.verification ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!reasonProblem) void confirmVoid();
            }}
          >
            <h3 className="text-sm font-semibold">{view.verification.voidTitle}</h3>
            <p className="text-xs text-muted-foreground">El link sigue funcionando pero muestra «anulado» con el motivo. Nunca se borra.</p>
            <label htmlFor="design-void-reason" className="text-xs font-medium text-muted-foreground">
              Motivo (obligatorio)
            </label>
            <textarea
              id="design-void-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={MAX_VOID_REASON}
              rows={3}
              placeholder="Ej.: nombre mal escrito"
              autoFocus
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMode("menu")} className="h-9 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!!reasonProblem || busy === "void"}
                title={reasonProblem ?? undefined}
                className="h-9 rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "void" ? "Anulando…" : view.verification.voidTitle}
              </button>
            </div>
            {notice?.tone === "error" && (
              <p role="alert" className="text-xs text-red-600">
                {notice.text}
              </p>
            )}
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{view.trigger.published ? "Publicado" : "Publicar"}</h3>
            {view.note && <p className="px-2 text-xs text-muted-foreground">{view.note}</p>}

            {view.link && (
              <input
                readOnly
                value={view.link.url}
                aria-label="Link del diseño"
                onFocus={(event) => event.currentTarget.select()}
                className="mx-1 rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground"
              />
            )}
            {view.linkHint && <p className="px-2 text-xs text-muted-foreground">{view.linkHint}</p>}

            {view.copy && (
              <button type="button" onClick={copy} className={itemClass}>
                Copiar link
              </button>
            )}
            {view.viewAsPublic && link && (
              <a href={link} target="_blank" rel="noopener noreferrer" className={itemClass}>
                Ver como el público
              </a>
            )}

            {view.downloadToggle && (
              <div className="flex items-center gap-2 px-2 py-1 text-sm">
                <Switch checked={allowDownload} onChange={(value) => toggle("download", value)} label="Permitir descargar" disabled={busy !== null} size="sm" />
                <span>Permitir descargar</span>
              </div>
            )}
            {view.indexingToggle && (
              <div className="flex items-center gap-2 px-2 py-1 text-sm">
                <Switch checked={allowIndexing} onChange={(value) => toggle("indexing", value)} label="Permitir que aparezca en buscadores" disabled={busy !== null} size="sm" />
                <span>Permitir que aparezca en buscadores</span>
              </div>
            )}

            {view.verification && (
              <div className="flex flex-col gap-1 border-t border-border pt-2">
                <p className="px-2 text-xs text-muted-foreground">{view.verification.text}</p>
                {view.verification.canVoid && (
                  <button type="button" onClick={() => setMode("void")} className={itemClass}>
                    {view.verification.voidLabel}
                  </button>
                )}
              </div>
            )}

            {view.publishNow && (
              <button
                type="button"
                onClick={publishNow}
                disabled={busy !== null}
                className="mt-1 h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy === "publish" ? "Publicando…" : "Publicar ahora"}
              </button>
            )}
            {view.unpublish && (
              <div className="border-t border-border pt-2">
                <button type="button" onClick={() => setConfirmUnpublish(true)} disabled={busy !== null} className={`${itemClass} text-red-600`}>
                  Despublicar
                </button>
              </div>
            )}
            <p role="status" aria-live="polite" className={`min-h-4 px-2 text-xs ${notice?.tone === "error" ? "text-red-600" : "text-muted-foreground"}`}>
              {notice?.text ?? ""}
            </p>
          </div>
        )}
      </Popover>
      <ConfirmDialog
        open={confirmUnpublish}
        title="¿Despublicar?"
        message="El link deja de funcionar enseguida. Lo podés volver a publicar y conserva el mismo código."
        confirmLabel="Despublicar"
        cancelLabel="Cancelar"
        destructive
        onCancel={() => setConfirmUnpublish(false)}
        onConfirm={() => {
          setConfirmUnpublish(false);
          void unpublish();
        }}
      />
    </>
  );
}
