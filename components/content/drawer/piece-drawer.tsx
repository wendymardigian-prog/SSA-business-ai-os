"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MutableRefObject,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, History, Loader2, Plus, Sparkles, X } from "lucide-react";
import { savePostDraft, movePostToColumn } from "@/lib/actions/content";
import { requestCopy } from "@/lib/actions/copywriter";
import {
  markNetworkPublished,
  scheduleNetworks,
  setNetworkPublishMode,
  unmarkNetworkPublished,
  unscheduleNetwork,
} from "@/lib/actions/content-schedule";
import {
  approvePost,
  archivePost,
  requestReview,
  retryFailedNetworks,
  returnPost,
} from "@/lib/actions/content-review";
import { summarizeNetwork } from "@/lib/content/editor";
import { validateNetwork } from "@/lib/content/validation";
import { findScriptKeywords } from "@/lib/content/keywords";
import { ensureMediaIds, removeFileFromNetworks, usageByFile } from "@/lib/content/media-library";
import { changeFormat, CONTENT_PLATFORMS, resolveNetworkOptions, suggestFormat } from "@/lib/content/network-format";
import { liveMedia } from "@/lib/content/media";
import { resolveNetworkContent, type NetworkEntry } from "@/lib/content/redistribution";
import { networkStateOf, networkSummaryText } from "@/lib/content/network-state";
import { systemPublishes } from "@/lib/content/network-card";
import { visibleValidation } from "@/lib/content/network-files";
import { applyGeneralDate, generalDateOf, inheritGeneralDate } from "@/lib/content/general-date";
import { AUTOSAVE_IDLE_MS } from "@/lib/content/save-status";
import { isPlaceholderTitle } from "@/lib/content/new-post";
import { datetimeInputToIso, isoToDatetimeInput } from "@/lib/dates";
import { defaultOptionsFor } from "@/lib/content/network-options";
import {
  copyJustFinished,
  draftFromPost,
  draftPayload,
  isEditableStatus,
  pieceButtons,
  publicationsVisible,
  shouldPollCopy,
  statusChangeAction,
  statusOptions,
  type PieceDraft,
} from "@/lib/content/piece-drawer";
import type { PieceData } from "@/lib/content/load-piece";
import { isManualStatus, type BoardColumn } from "@/lib/content/status";
import { platformLabel } from "@/lib/platforms";
import type { ContentPostStatus } from "@/lib/types/database";
import { MediaUploader } from "../media-uploader";
import { VersionHistory } from "../version-history";
import { NetworkBadge } from "../network-badge";
import { NetworkRow } from "../editor/network-row";
import { ClassificationFields } from "../classification-fields";
import { Drawer } from "./drawer";
import { PiecePerformanceSection } from "./piece-performance";
import { LinkAdMenu } from "./link-ad-menu";
import { showAdsSection } from "@/lib/meta/content-ad-summary";
import { PieceAdsSection } from "./piece-ads-section";
import { PiecePublications } from "./piece-publications";
import { PieceAttribution } from "./piece-attribution";
import { SaveIndicator } from "./save-indicator";
import { AssigneeSelect } from "./assignee-select";
import { StatusSelect } from "./status-select";
import { useToast } from "./toast";

/**
 * El drawer de la pieza (F96, F97): reemplaza al editor (F24) y al detalle (F36).
 *
 * Una sola pantalla, sin pestañas, comprimida para ahorrar espacio, en este
 * orden: clasificacion en una franja (referencia, formato, pilar, etapa,
 * producto) → guion → caption base → notas de grabacion (plegadas) → archivos →
 * fecha general → una tarjeta por red → agregar una red. Todo es editable al
 * abrir, sin ningun clic previo (mientras la pieza este en Borrador,
 * Produccion o Revision; despues es de quien aprueba y publica).
 *
 * Sin vista previa del telefono: es una decision de producto (como el
 * prototipo v5). El historial esta detras de un boton de reloj y ocupa el
 * mismo drawer, con "← Volver al post".
 *
 * Guardado: al elegir en un selector, al salir de un campo de texto, a los pocos
 * segundos de dejar de escribir, siempre antes de cualquier accion que cambie
 * el estado y al cerrar. Los guardados van de a uno (una cola), y la cabecera
 * dice SIEMPRE en que estado esta (Guardado, Guardando, Cambios sin guardar o
 * No se pudo guardar). Si alguien mas la edito mientras tanto, gana el ultimo
 * que guarda y se avisa (F24). Cuando llega una version nueva desde el servidor
 * (la restauracion, o el copywriter que termino) y no hay cambios sin guardar,
 * el borrador la adopta.
 */

const COPY_POLL_MS = 4_000;

export function PieceDrawer({
  data,
  returnFocus,
  onClose,
}: {
  data: PieceData;
  returnFocus: MutableRefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { post, perms, publications, connected, automations, channelIdByPlatform, publishersByPlatform } = data;
  const { defaultPublisherByPlatform } = data;
  const { versions, authorNames, aiAvailable, timeZone, taxonomy } = data;

  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<"edit" | "history">("edit");
  const [openNetwork, setOpenNetwork] = useState<string | null>(null);
  const [draft, setDraft] = useState<PieceDraft>(() => draftFromPost(post));
  // El estado de guardado que ve la persona, siempre: hay un guardado en vuelo,
  // o el ultimo fallo. "Hay cambios sin guardar" es `dirty`, mas abajo.
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const inFlight = useRef(0);
  const saveChain = useRef<Promise<boolean>>(Promise.resolve(true));
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  // Una pieza recien creada arranca con "Sin título": se deja seleccionado para escribir encima.
  const startsUntitled = useRef(isPlaceholderTitle(post.title));
  const [notesOpen, setNotesOpen] = useState(() => Boolean(post.recordingNotes?.trim()));
  // En "cada red", pedir una fecha para todas de nuevo.
  const [pickGeneral, setPickGeneral] = useState(false);

  // "Hay cambios sin guardar". Vive en dos lugares a proposito: un ref que
  // lee quien guarda (un reloj, un clic) y necesita el valor de AHORA, y un
  // estado que lee el render (para decidir si adopta lo que llega del
  // servidor). `markDirty` escribe los dos.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);
  // El borrador de ahora, para que el guardado (que corre en un reloj o en un
  // clic) escriba lo ultimo y no lo que habia cuando se creo la funcion.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  // La fecha de la ULTIMA escritura que conocemos: se actualiza con lo que
  // devuelve cada guardado. Con la de la primera carga, el aviso de "alguien
  // mas edito esto" saltaba desde el segundo autoguardado.
  const knownUpdatedAt = useRef(post.updatedAt);
  // El responsable que hay guardado: solo se manda al guardar si cambio.
  const savedAssignee = useRef(post.assignedTo ?? "");

  const generating = post.copyStatus === "generating";
  // Mientras el copywriter escribe nada se edita: lo que escribiera una
  // persona en ese rato se pisaria cuando el job termina.
  const editable = isEditableStatus(post.status) && !generating && data.canEdit;
  const library = useMemo(() => liveMedia(ensureMediaIds(post.media)), [post.media]);

  // ── Guardar ─────────────────────────────────────────────────────────────
  // Los guardados van en CADA UNO despues del anterior (una cola): dos a la vez
  // mandarian el mismo `knownUpdatedAt` y el segundo avisaria "alguien mas
  // edito" por algo que hizo esta misma persona un segundo antes.
  const flush = useCallback((): Promise<boolean> => {
    if (!dirtyRef.current && inFlight.current === 0) return Promise.resolve(true);

    const run = async (): Promise<boolean> => {
      if (!dirtyRef.current) return true;
      markDirty(false);
      const sent = draftRef.current;
      let result: Awaited<ReturnType<typeof savePostDraft>>;
      try {
        result = await savePostDraft({
          ...draftPayload(post.id, sent, savedAssignee.current),
          knownUpdatedAt: knownUpdatedAt.current,
        });
      } catch {
        result = { ok: false, error: "No hay conexión con el servidor. Se reintenta al seguir editando." };
      }

      if (!result.ok) {
        markDirty(true);
        setSaveFailed(true);
        toast.push({ tone: "error", text: result.error });
        return false;
      }

      knownUpdatedAt.current = result.data.updatedAt;
      savedAssignee.current = sent.assignedTo;
      setSaveFailed(false);
      if (result.data.staleWarning) {
        toast.push({
          tone: "warning",
          text: "Alguien más editó esta pieza mientras la tenías abierta. Se guardó lo tuyo; conviene recargar para ver lo suyo.",
        });
      }
      for (const warning of result.data.rescheduleWarnings) toast.push({ tone: "warning", text: warning });
      return true;
    };

    inFlight.current += 1;
    setSaving(true);
    const queued = saveChain.current.then(run, run).finally(() => {
      inFlight.current -= 1;
      if (inFlight.current === 0) setSaving(false);
    });
    saveChain.current = queued;
    return queued;
  }, [post.id, toast, markDirty]);

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );

  // Guardado automatico (C6): el dropdown, un chip o un toggle guardan al
  // elegir; un campo de texto, al salir (blur). Los dos casos llegan aca por
  // delegacion (un solo listener en la raiz del cuerpo) en vez de cablear
  // cada campo uno por uno. `setTimeout` deja que React termine de aplicar
  // el cambio de estado del campo (el `useEffect` que actualiza `draftRef`)
  // ANTES de leerlo: guardar en el mismo tick guardaria el valor anterior.
  const flushSoon = useCallback(() => {
    setTimeout(() => void flush(), 0);
  }, [flush]);

  function onBodyChangeCapture(e: React.ChangeEvent<HTMLElement>) {
    const el = e.target as HTMLInputElement;
    // Select, checkbox, radio y los selectores de fecha disparan "change" al
    // elegir: eso es "al elegir" (C6). Un input o textarea de texto dispara
    // "change" en CADA tecla (es como React nombra el evento `input` nativo):
    // esos se guardan en el blur, no aca.
    if (
      el.tagName === "SELECT" ||
      ["checkbox", "radio", "datetime-local", "date"].includes(el.type)
    ) {
      flushSoon();
    }
  }

  function onBodyBlurCapture(e: React.FocusEvent<HTMLElement>) {
    const el = e.target as HTMLInputElement;
    if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type === "text")) {
      flushSoon();
    }
  }

  // Lo escrito se guarda tambien si el drawer se desmonta (Esc, fondo, atras).
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => void flushRef.current(), []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || inFlight.current > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function edit<K extends keyof PieceDraft>(key: K, value: PieceDraft[K]) {
    markDirty(true);
    setDraft((d) => ({ ...d, [key]: value }));
    // Red de seguridad para quien escribe un rato sin salir del campo: a los
    // pocos segundos de quedarse quieto, se guarda. Cada cambio reinicia la espera.
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => void flushRef.current(), AUTOSAVE_IDLE_MS);
  }

  // El foco de una pieza recien creada: el titulo, seleccionado. Va en un
  // efecto de ESTE componente y no con `autoFocus`: el drawer lleva el foco a
  // su panel al montarse, y este efecto corre despues del suyo.
  useEffect(() => {
    if (!startsUntitled.current) return;
    titleInput.current?.focus();
    titleInput.current?.select();
  }, []);

  // ── Lo que llega del servidor ───────────────────────────────────────────
  // Sin cambios sin guardar, el borrador adopta lo que hay en el servidor: es
  // lo que hace que se vea el guion que acaba de escribir el copywriter y la
  // version restaurada. Con cambios sin guardar NO se pisa nada: el aviso al
  // guardar se encarga de decir que otra persona edito.
  //
  // Es estado derivado de una prop (se ajusta en el render cuando cambia la
  // fecha de la pieza), no un efecto que lo corrija un render despues.
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(post.updatedAt);
  if (post.updatedAt !== seenUpdatedAt) {
    setSeenUpdatedAt(post.updatedAt);
    if (!dirty) setDraft(draftFromPost(post));
  }
  useEffect(() => {
    if (!dirtyRef.current) {
      knownUpdatedAt.current = post.updatedAt;
      savedAssignee.current = post.assignedTo ?? "";
    }
  }, [post.updatedAt, post.assignedTo]);

  // Mientras el copywriter escribe, se vuelve a preguntar hasta que termine.
  useEffect(() => {
    if (!shouldPollCopy(post.copyStatus)) return;
    const timer = setInterval(() => router.refresh(), COPY_POLL_MS);
    return () => clearInterval(timer);
  }, [post.copyStatus, router]);

  const previousCopy = useRef(post.copyStatus);
  useEffect(() => {
    if (copyJustFinished(previousCopy.current, post.copyStatus)) {
      toast.push(
        post.copyStatus === "failed"
          ? { tone: "error", text: "El copywriter no pudo escribir. Probá de nuevo." }
          : { tone: "ok", text: "El copywriter terminó: revisá el guion y los captions." },
      );
    }
    previousCopy.current = post.copyStatus;
  }, [post.copyStatus, toast]);

  // ── Validacion por red, en vivo ─────────────────────────────────────────
  const validations = useMemo(
    () =>
      draft.networks.map((network) => {
        const resolved = resolveNetworkContent({ network, baseCaption: draft.caption, baseMedia: library });
        // Con el formato ya aplicado: lo mismo que valida el servidor al programar.
        return validateNetwork({
          platform: network.platform,
          text: resolved.caption,
          media: resolved.media,
          title: network.youtube_title,
          format: network.format ?? null,
          options: resolveNetworkOptions(network),
        });
      }),
    [draft.networks, draft.caption, library],
  );

  /** Que redes usa cada archivo de la biblioteca (F92). */
  const usage = useMemo(() => Object.fromEntries(usageByFile(library, draft.networks)), [library, draft.networks]);

  /** Las palabras en mayuscula del cierre del guion, y si alguna automatizacion las contesta (C11). */
  const detectedKeywords = useMemo(() => {
    const activas = new Set(
      automations
        .filter((rule) => rule.isActive)
        .flatMap((rule) => rule.keywords.map((k) => k.value.trim().toUpperCase())),
    );
    return findScriptKeywords(draft.script).map((word) => ({ word, live: activas.has(word.toUpperCase()) }));
  }, [draft.script, automations]);

  // Cualquiera de las cinco, conectada o no (Contenido v4, C1): el bloqueo
  // de antes impedia planificar YouTube, LinkedIn y Threads hasta tramitar
  // la cuenta.
  const missingNetworks = CONTENT_PLATFORMS.filter((platform) => !draft.networks.some((n) => n.platform === platform));
  const withDate = draft.networks.filter((n) => n.planned_at).length;
  const schedulable = validations.filter((v) => v.ok).length;

  // El estado de cada red (C3), para el pie (C8): "N programadas · N
  // tentativas · N publicadas", y para distinguir de un vistazo lo que sale
  // solo de lo que hay que subir a mano.
  const networkStates = draft.networks.map((network) => {
    const publication = publications.find((p) => p.platform === network.platform);
    return networkStateOf({
      plannedAt: network.planned_at ?? null,
      publication: publication
        ? {
            platform: publication.platform,
            status: publication.status,
            scheduledAt: publication.scheduledAt,
            publishedAt: publication.publishedAt,
            origin: publication.origin,
          }
        : undefined,
      connected: connected.includes(network.platform),
    });
  });

  // Una red ya publicada (o publicandose) no cambia de fecha con la general.
  const closedPlatforms = new Set(
    draft.networks
      .filter((_, i) => networkStates[i].id === "pub" || networkStates[i].label === "Publicando")
      .map((n) => n.platform),
  );
  const generalDate = generalDateOf(draft.networks, closedPlatforms);

  const buttons = pieceButtons({
    status: post.status,
    perms,
    hasDates: withDate > 0,
    aiAvailable,
    schedulable,
    publications,
  });

  const statuses = statusOptions(
    { create: perms.create, approve: perms.approve, publish: perms.publish, isAuthor: perms.isAuthor },
    post.status,
  );

  function run(action: () => Promise<{ ok: boolean; error?: string }>, okText?: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        if (okText) toast.push({ tone: "ok", text: okText });
      } else {
        toast.push({ tone: "error", text: result.error ?? "No se pudo" });
      }
      router.refresh();
    });
  }

  /** Lo escrito se guarda antes de cualquier accion que cambie el estado. */
  async function saved(then: () => Promise<{ ok: boolean; error?: string }>) {
    if (!(await flush())) return { ok: false, error: "No pude guardar lo que escribiste. Probá de nuevo." };
    return then();
  }

  async function close() {
    await flush();
    onClose();
  }

  function changeStatus(to: ContentPostStatus) {
    const kind = statusChangeAction(post.status, to);
    if (!kind) return;

    if (kind === "return") {
      const comment = window.prompt("¿Qué hay que cambiar? (lo ve quien la escribió)");
      if (comment === null) return;
      run(() => saved(() => returnPost({ postId: post.id, comment })), "Devuelta a producción.");
      return;
    }
    if (kind === "request_review") {
      run(() => saved(() => requestReview({ postId: post.id })), "La mandaste a revisión.");
      return;
    }
    if (kind === "approve") {
      run(() => saved(() => approvePost({ postId: post.id })), "Aprobada.");
      return;
    }
    run(() => saved(() => movePostToColumn(post.id, to as BoardColumn)));
  }

  function onAction(action: string) {
    switch (action) {
      case "generate_copy":
        run(async () => {
          // El copywriter escribe en segundo plano: esto encola y vuelve.
          const first = await requestCopy({ postId: post.id });
          if (!first.ok && first.needsConfirmation) {
            // Pisar el guion de alguien sin preguntar es lo que hace que una
            // funcion util deje de usarse.
            if (!window.confirm(`${first.error} ¿Sigo?`)) return { ok: true };
            return requestCopy({ postId: post.id, confirmed: true });
          }
          return first;
        }, "El copywriter está escribiendo. Te aviso cuando termine.");
        break;

      case "schedule":
        run(() => saved(() => scheduleNetworks({ postId: post.id })), "Programado.");
        break;

      case "publish_now":
        if (!window.confirm("¿Publicar ahora en las redes con fecha?")) return;
        run(() => saved(() => scheduleNetworks({ postId: post.id, now: true })), "Saliendo.");
        break;

      case "approve":
        run(() => saved(() => approvePost({ postId: post.id })), "Aprobada.");
        break;

      case "return_to_draft": {
        const comment = window.prompt("¿Qué hay que cambiar? (lo ve quien la escribió)");
        if (comment === null) return;
        run(() => returnPost({ postId: post.id, comment }), "Devuelta a producción.");
        break;
      }

      case "retry_all":
        run(() => retryFailedNetworks({ postId: post.id }), "Reintentando las que fallaron.");
        break;

      case "archive":
        if (!window.confirm("¿Archivar esta pieza? Sale del tablero y queda en el historial.")) return;
        run(async () => {
          const result = await archivePost({ postId: post.id });
          if (result.ok) onClose();
          return result;
        }, "Archivada.");
        break;
    }
  }

  // ── El historial, detras de un boton (F97) ──────────────────────────────
  if (view === "history") {
    return (
      <Drawer
        size="piece"
        label={`Historial de ${draft.title || post.title}`}
        onClose={() => void close()}
        returnFocus={returnFocus}
        header={
          <>
            <button
              type="button"
              onClick={() => setView("edit")}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Volver al post
            </button>
            <span className="flex-1" />
            <span className="text-xs text-muted-foreground">
              {versions.length} {versions.length === 1 ? "versión" : "versiones"} · se guardan las últimas 50
            </span>
            <CloseButton onClick={() => void close()} />
          </>
        }
      >
        <div className="space-y-3 p-4 md:p-6">
          <p className="text-xs text-muted-foreground">
            Todo se guarda solo, sin crear una versión por cada cambio: el primer cambio después de 10 minutos de
            silencio abre una versión nueva, y los siguientes de la misma sesión actualizan esa misma fila. Cambiar de
            estado, aprobar, generar con IA y restaurar siempre cortan la sesión y dejan la suya. Restaurar nunca
            borra: crea una versión nueva.
          </p>
          <VersionHistory
            postId={post.id}
            versions={versions}
            current={{
              title: draft.title,
              format: draft.format.trim() || null,
              script: draft.script,
              recording_notes: draft.recording_notes,
              caption: draft.caption,
              networks: draft.networks,
              media: library,
            }}
            authorNames={authorNames}
            canEdit={editable}
            onRestored={(snapshot) => {
              // Restaurar pisa lo que hubiera sin guardar, y se vuelve al post.
              markDirty(false);
              setDraft((d) => ({
                ...d,
                title: snapshot.title,
                format: snapshot.format ?? "",
                script: snapshot.script ?? "",
                recording_notes: snapshot.recording_notes ?? "",
                caption: snapshot.caption ?? "",
                networks: snapshot.networks as PieceDraft["networks"],
              }));
              toast.push({ tone: "ok", text: "Versión restaurada. Se creó una versión nueva." });
              setView("edit");
            }}
          />
        </div>
      </Drawer>
    );
  }

  // ── El post ─────────────────────────────────────────────────────────────
  const canEditDate = editable || perms.publish;
  const addNetwork = (platform: string) => {
    const base: NetworkEntry = {
      platform,
      planned_at: null,
      options: defaultOptionsFor(platform),
    };
    // El formato NO arranca vacio (C9): hereda el de la pieza, ya elegido (y con
    // sus archivos, si hay uno que sirva), en vez de dejar que la persona lo adivine.
    const suggested = suggestFormat(platform, draft.format);
    const withFormat = suggested ? changeFormat(base, suggested, library) : base;
    // Y la fecha general, si la hay: sumar una red no la deja sin fecha.
    edit("networks", [...draft.networks, inheritGeneralDate(withFormat, draft.networks, closedPlatforms)]);
    setOpenNetwork(platform);
  };

  return (
    <Drawer
      size="piece"
      label={draft.title || post.title}
      onClose={() => void close()}
      returnFocus={returnFocus}
      header={
        <>
          <input
            ref={titleInput}
            value={draft.title}
            onChange={(e) => edit("title", e.target.value)}
            disabled={!editable}
            aria-label="Título interno"
            placeholder="Título interno"
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold hover:border-border focus:border-border focus:outline-none disabled:opacity-70"
          />
          {/* El estado de guardado, siempre a la vista (no se va a los 1,5 s). */}
          {editable && (
            <SaveIndicator status={{ dirty, saving, failed: saveFailed }} onRetry={() => void flush()} />
          )}
          <StatusSelect
            options={statuses}
            value={post.status}
            derived={!isManualStatus(post.status)}
            disabled={pending || statuses.every((o) => o.value === post.status || o.disabled)}
            onChange={changeStatus}
          />
          {post.aiUnreviewed && (
            <span className="hidden rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 sm:inline dark:text-amber-300">
              ✦ IA · revisalo
            </span>
          )}
          {/* «⋯»: vincular la pieza con un anuncio de Meta (A2). Solo lo ve quien puede editar piezas y ver anuncios. */}
          {data.canLinkAds && <LinkAdMenu pieceId={post.id} pieceTitle={draft.title || post.title} ads={data.ads} />}
          <button
            type="button"
            onClick={() => void flush().then(() => setView("history"))}
            aria-label={`Historial de versiones (${versions.length})`}
            title="Historial de versiones"
            className="relative rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
          >
            <History className="h-4 w-4" aria-hidden />
            {versions.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-medium leading-4 text-primary-foreground">
                {versions.length}
              </span>
            )}
          </button>
          <CloseButton onClick={() => void close()} />
        </>
      }
      footer={
        <>
          <span className="text-xs text-muted-foreground">{networkSummaryText(networkStates)}</span>
          <span className="flex-1" />
          {buttons.map((button) => (
            <button
              key={button.action}
              type="button"
              disabled={pending || Boolean(button.disabledReason)}
              title={button.disabledReason}
              onClick={() => onAction(button.action)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-50 ${
                button.tone === "primary"
                  ? "bg-primary text-primary-foreground"
                  : button.tone === "danger"
                    ? "border border-border text-muted-foreground"
                    : "border border-border"
              }`}
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {button.action === "generate_copy" && !pending && <Sparkles className="h-4 w-4" aria-hidden />}
              {button.label}
            </button>
          ))}
        </>
      }
    >
      <div
        className="space-y-4 p-4 md:px-5 md:py-4"
        onChangeCapture={onBodyChangeCapture}
        onBlurCapture={onBodyBlurCapture}
      >
        {/* ── Arriba de todo: referencia, formato, pilar, etapa y producto, en una franja ── */}
        <section aria-label="Clasificación" className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {post.authorship && (
                <p className="text-[11px] text-muted-foreground" data-testid="authorship">
                  {post.authorship}
                </p>
              )}
              {post.idea && (
                <details className="group text-xs">
                  <summary className="cursor-pointer list-none text-[11px] text-muted-foreground hover:text-foreground">
                    💡 Idea de origen: <span className="font-medium text-foreground">{post.idea.title}</span>
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                    {post.idea.content?.trim() || "Esta idea no tenía texto."}
                  </p>
                </details>
              )}
            </div>
            <AssigneeSelect
              team={data.team}
              value={draft.assignedTo}
              onChange={(id) => edit("assignedTo", id)}
              disabled={!editable || !data.canAssign}
              disabledReason={
                editable ? "Solo quien creó la pieza o un administrador puede cambiar el responsable." : undefined
              }
            />
          </div>
          <ClassificationFields
            compact
            value={{
              format: draft.format,
              pillarId: draft.pillarId,
              offerId: draft.offerId,
              funnelStage: draft.funnelStage,
              reference: draft.reference,
            }}
            onChange={(patch) => {
              if (patch.format !== undefined) edit("format", patch.format);
              if (patch.pillarId !== undefined) edit("pillarId", patch.pillarId);
              if (patch.offerId !== undefined) edit("offerId", patch.offerId);
              if (patch.funnelStage !== undefined) edit("funnelStage", patch.funnelStage);
              if (patch.reference !== undefined) edit("reference", patch.reference);
            }}
            taxonomy={taxonomy}
            disabled={!editable}
          />
          {!isEditableStatus(post.status) && (
            <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">
              Esta pieza ya pasó a revisión final o a publicación: el contenido solo lo cambian quienes aprueban y
              publican.
            </p>
          )}
          {isEditableStatus(post.status) && !data.canEdit && (
            <p role="status" className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">
              Solo podés mirarla: esta pieza la edita quien la creó o un administrador.
            </p>
          )}
        </section>

        {/* Código de atribución y generador de links (Extra I, F38 y F42): solo si la pieza ya tiene código. */}
        <PieceAttribution code={post.attributionCode} pieceTitle={draft.title || post.title} />

        <PiecePublications
          publications={publications}
          timeZone={timeZone}
          canPublish={perms.publish}
          reviewNote={post.reviewNote}
        />

        {/* Rendimiento por red (F102): solo si alguna publicacion ya salio. */}
        <PiecePerformanceSection performance={data.measurement} timeZone={timeZone} />

        {/* Publicidad (A2): solo si la pieza tiene al menos un anuncio vinculado; sin anuncio, el detalle queda como siempre. */}
        {showAdsSection(data.ads) && <PieceAdsSection pieceId={post.id} ads={data.ads} />}

        {/* ── Guion (sin titulo aparte: el campo ya dice que es) ── */}
        <section className="space-y-1" aria-label="Guion y caption">
          {generating ? (
            <p
              role="status"
              className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              El copywriter está escribiendo el guion y los captions a partir de la idea…
            </p>
          ) : (
            <>
              <label className="block">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    Guion
                    {post.aiUnreviewed && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-normal text-amber-700 dark:text-amber-300">
                        ✦ Generado por el copywriter · revisalo antes de aprobar
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Para quien graba. Lo que se publica es el caption.
                  </span>
                </span>
                <textarea
                  rows={8}
                  value={draft.script}
                  onChange={(e) => edit("script", e.target.value)}
                  disabled={!editable}
                  placeholder="El gancho, el desarrollo y el cierre. El último párrafo es el cierre. O generalo con IA."
                  className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm"
                />
              </label>
              {detectedKeywords.length > 0 && (
                <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-muted-foreground">Palabras clave detectadas:</span>
                  {detectedKeywords.map(({ word, live }) => (
                    <span
                      key={word}
                      className={
                        live
                          ? "rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400"
                          : "rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300"
                      }
                      title={live ? "Dispara una automatización activa" : "Ninguna automatización responde a esta palabra"}
                    >
                      {live ? "⚡ " : "⚠ "}
                      {word}
                    </span>
                  ))}
                </span>
              )}
            </>
          )}
        </section>

        {/* ── Caption base, justo despues del guion ── */}
        <section aria-label="Caption base">
          <label className="block">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-xs font-medium">Caption base</span>
              <span className="text-[11px] text-muted-foreground">
                Punto de partida de todas las redes, salvo las que tengan uno propio.
              </span>
            </span>
            <textarea
              rows={3}
              value={draft.caption}
              onChange={(e) => edit("caption", e.target.value)}
              disabled={!editable}
              placeholder="El texto que acompaña la publicación."
              className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm"
            />
          </label>
        </section>

        {/* ── Notas de grabacion: opcionales, plegadas hasta que hacen falta ── */}
        {!generating && (
          <section aria-label="Notas de grabación">
            <button
              type="button"
              onClick={() => setNotesOpen((open) => !open)}
              aria-expanded={notesOpen}
              className="inline-flex items-center gap-1 rounded-md py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {notesOpen ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              )}
              {notesOpen || draft.recording_notes.trim() ? "Notas de grabación" : "+ Notas de grabación"}
              {!notesOpen && draft.recording_notes.trim() && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal">con notas</span>
              )}
            </button>
            {notesOpen && (
              <textarea
                rows={3}
                aria-label="Notas de grabación"
                value={draft.recording_notes}
                onChange={(e) => edit("recording_notes", e.target.value)}
                disabled={!editable}
                placeholder="Encuadre, b-roll, duración, qué mostrar en pantalla… Es para quien graba, no sale publicado."
                className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm"
              />
            )}
          </section>
        )}

        {/* ── Archivos de la pieza (F92) ── */}
        <section aria-labelledby="archivos">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 id="archivos" className="text-xs font-semibold">
              Archivos de la pieza
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Se suben una vez. Después cada red elige cuáles publica y en qué orden.
            </p>
          </div>
          <div className="mt-1.5">
            <MediaUploader
              postId={post.id}
              media={library}
              usage={usage}
              canEdit={editable}
              onRemoved={(fileId) =>
                // El servidor ya lo saco de las redes; el borrador local
                // tiene que enterarse o lo volveria a mostrar y a guardar.
                setDraft((d) => ({ ...d, networks: removeFileFromNetworks(d.networks, fileId).networks }))
              }
            />
          </div>
        </section>

        {/* ── Fecha general: una para toda la pieza, salvo que una red tenga la suya ── */}
        <section
          aria-label="Fecha de publicación de la pieza"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border px-3 py-2"
        >
          <span className="text-xs font-medium">Fecha de publicación</span>

          {generalDate.mode === "general" && (
            <>
              <input
                type="datetime-local"
                aria-label="Fecha general de la pieza"
                value={isoToDatetimeInput(generalDate.at, timeZone)}
                onChange={(e) =>
                  edit("networks", applyGeneralDate(draft.networks, datetimeInputToIso(e.target.value, timeZone), closedPlatforms))
                }
                disabled={!canEditDate}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-70"
              />
              {generalDate.at ? (
                canEditDate && (
                  <button
                    type="button"
                    onClick={() => edit("networks", applyGeneralDate(draft.networks, null, closedPlatforms))}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Borrar
                  </button>
                )
              ) : (
                <span className="text-[11px] text-muted-foreground">Sale en todas las redes a la vez.</span>
              )}
            </>
          )}

          {generalDate.mode === "per_network" &&
            (pickGeneral ? (
              <>
                <input
                  type="datetime-local"
                  aria-label="Fecha para todas las redes"
                  value=""
                  onChange={(e) => {
                    const iso = datetimeInputToIso(e.target.value, timeZone);
                    if (!iso) return;
                    edit("networks", applyGeneralDate(draft.networks, iso, closedPlatforms));
                    setPickGeneral(false);
                  }}
                  disabled={!canEditDate}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-70"
                />
                <button
                  type="button"
                  onClick={() => setPickGeneral(false)}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">La fecha se asigna en cada red.</span>
                {canEditDate && (
                  <button
                    type="button"
                    onClick={() => setPickGeneral(true)}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Usar la misma para todas
                  </button>
                )}
              </>
            ))}

          {generalDate.mode === "none" && (
            <span className="text-xs text-muted-foreground">Agregá una red para elegir cuándo sale.</span>
          )}
        </section>

        {/* ── Una tarjeta por red ── */}
        <section aria-labelledby="redes">
          <h2 id="redes" className="text-sm font-semibold">
            Publicación por red
          </h2>

          {/* El estado vacio ya no bloquea: es informativo, con el link a
              Integraciones (C1). La planificacion sigue andando igual. */}
          {connected.length === 0 && (
            <p className="mt-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              Todavía no hay ninguna red conectada. Podés planificar igual: lo que subas a mano lo marcás con
              &quot;Marcar como publicado&quot;.{" "}
              <Link href="/dashboard/settings/integrations" className="underline underline-offset-2">
                Conectar una red
              </Link>
            </p>
          )}

          {draft.networks.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
              Esta pieza todavía no tiene redes. Agregá una acá abajo.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {draft.networks.map((network, index) => {
                const publication = publications.find((p) => p.platform === network.platform);
                // Lo que se le muestra a la persona: los archivos solo son un
                // error si la red la publica el sistema (la validacion estricta
                // es la que sigue usando el pie y el servidor).
                const shown = visibleValidation(
                  validations[index],
                  systemPublishes({ network, publication, connected: connected.includes(network.platform) }),
                );
                const summary = summarizeNetwork({
                  network,
                  publication: publication
                    ? { platform: publication.platform, status: publication.status, scheduledAt: publication.scheduledAt }
                    : undefined,
                  timeZone,
                  errors: shown.errors.length,
                  warnings: shown.warnings.length,
                });

                return (
                  <NetworkRow
                    key={network.platform}
                    postId={post.id}
                    network={network}
                    summary={summary}
                    validation={validations[index]}
                    publicationStatus={publication?.status ?? null}
                    publication={
                      publication
                        ? {
                            platform: publication.platform,
                            status: publication.status,
                            scheduledAt: publication.scheduledAt,
                            publishedAt: publication.publishedAt,
                            origin: publication.origin,
                          }
                        : undefined
                    }
                    connected={connected.includes(network.platform)}
                    postStatus={post.status}
                    open={openNetwork === network.platform}
                    editable={editable}
                    canPublish={perms.publish}
                    pending={pending}
                    timeZone={timeZone}
                    automations={automations}
                    channelId={channelIdByPlatform[network.platform] ?? null}
                    publishers={publishersByPlatform[network.platform] ?? []}
                    defaultPublisher={defaultPublisherByPlatform[network.platform] ?? null}
                    library={library}
                    usesGeneralDate={
                      generalDate.mode === "general" && Boolean(generalDate.at) && !closedPlatforms.has(network.platform)
                    }
                    onToggle={() => setOpenNetwork(openNetwork === network.platform ? null : network.platform)}
                    onChange={(patch) =>
                      edit(
                        "networks",
                        draft.networks.map((n, i) => (i === index ? { ...n, ...patch } : n)),
                      )
                    }
                    onRemove={() =>
                      edit(
                        "networks",
                        draft.networks.filter((_, i) => i !== index),
                      )
                    }
                    onSchedule={() =>
                      run(
                        () => saved(() => scheduleNetworks({ postId: post.id, platform: network.platform })),
                        `${platformLabel(network.platform)} programado.`,
                      )
                    }
                    onUnschedule={() =>
                      run(
                        () => unscheduleNetwork({ postId: post.id, platform: network.platform }),
                        "Desprogramada. La fecha queda guardada.",
                      )
                    }
                    onSetAuto={(auto) =>
                      run(
                        () => saved(() => setNetworkPublishMode({ postId: post.id, platform: network.platform, auto })),
                        auto
                          ? `${platformLabel(network.platform)}: queda programado, se publica solo.`
                          : `${platformLabel(network.platform)}: fecha tentativa, la subís vos.`,
                      )
                    }
                    onMarkPublished={(input) =>
                      run(
                        () => markNetworkPublished({ postId: post.id, platform: network.platform, ...input }),
                        `${platformLabel(network.platform)}: marcado como publicado.`,
                      )
                    }
                    onUnmarkPublished={() =>
                      run(
                        () => unmarkNetworkPublished({ postId: post.id, platform: network.platform }),
                        "Deshecho.",
                      )
                    }
                  />
                );
              })}
            </ul>
          )}

          {/* Agregar una red que la pieza todavia no tiene (C9): conectada o no. */}
          {editable && missingNetworks.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Agregar una red:</span>
              {missingNetworks.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => addNetwork(platform)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-border px-3.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  <NetworkBadge platform={platform} variant="dot" size="sm" />
                  {platformLabel(platform)}
                  {!connected.includes(platform) && (
                    <span className="text-[11px] text-amber-700 dark:text-amber-400">a mano</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        {publicationsVisible(publications) && !data.measurement && (
          <p className="text-[11px] text-muted-foreground">
            El rendimiento de cada publicación aparece arriba cuando salga la primera.
          </p>
        )}
      </div>
    </Drawer>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Cerrar"
      className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
  );
}
