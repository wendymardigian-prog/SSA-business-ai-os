"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { approveIdea, discardIdea, updateIdea } from "@/lib/actions/content";
import type { BoardIdea } from "@/lib/content/board";
import {
  galleryPosition,
  stepAfter,
  canEditIdea,
  type GalleryAction,
  type GalleryPosition,
} from "@/lib/content/idea-gallery";
import { ideaActions } from "@/lib/content/ideas";
import { cn } from "@/lib/utils";
import { ClassificationFields, type TaxonomyOptions } from "../classification-fields";
import { DialogField, fieldInput } from "../dialog";
import { Drawer } from "./drawer";
import { useToast } from "./toast";

/**
 * El drawer de una idea, con galeria (F95).
 *
 * TODO es editable al abrir: no hay modo lectura ni boton "Editar". Lo que se
 * escribe se guarda solo (a los ~1 s de dejar de tocar) y siempre antes de
 * pasar a otra idea o de decidir sobre esta.
 *
 * Se revisan las ideas una atras de otra sin cerrar el drawer: descartar o
 * aprobar abre la siguiente (`stepAfter`). "Aprobar y producir copy" rompe la
 * secuencia y abre LA PIEZA generada en el mismo drawer. Cuando no queda
 * ninguna, el drawer se cierra con un aviso.
 */

const AUTOSAVE_MS = 900;

interface Values {
  title: string;
  content: string;
  format: string;
  reference: string;
  platforms: string[];
  pillarId: string;
  offerId: string;
  funnelStage: string;
}

function valuesOf(idea: BoardIdea): Values {
  return {
    title: idea.title,
    content: idea.content ?? "",
    format: idea.format ?? "",
    reference: idea.reference ?? "",
    platforms: idea.platforms,
    pillarId: idea.pillar?.id ?? "",
    offerId: idea.offer?.id ?? "",
    funnelStage: idea.funnelStage ?? "",
  };
}

export function IdeaDrawer({
  ideas,
  currentId,
  taxonomy,
  platforms,
  perms,
  aiAvailable,
  aiReason,
  userId,
  returnFocus,
  onOpenIdea,
  onOpenPiece,
  onClose,
}: {
  /** Las ideas sin decidir, en el orden del tablero. */
  ideas: BoardIdea[];
  currentId: string;
  taxonomy: TaxonomyOptions;
  /** Las redes conectadas. */
  platforms: string[];
  perms: { approve: boolean; ai: boolean };
  aiAvailable: boolean;
  aiReason?: string;
  userId: string;
  returnFocus: MutableRefObject<HTMLElement | null>;
  onOpenIdea: (id: string) => void;
  onOpenPiece: (id: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const idea = ideas.find((i) => i.id === currentId);

  const ids = ideas.map((i) => i.id);
  const position = galleryPosition(ids, currentId);
  const editable = idea ? canEditIdea({ approve: perms.approve, createdBy: idea.createdBy, userId }) : false;

  const [values, setValues] = useState<Values>(() => (idea ? valuesOf(idea) : valuesOf(EMPTY)));
  const [loadedId, setLoadedId] = useState(currentId);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [busy, setBusy] = useState<GalleryAction | null>(null);

  const dirty = useRef(false);
  // Lo ultimo escrito, para que el guardado (que corre en un reloj o en un
  // clic) lea el valor de ahora y no el de cuando se creo la funcion.
  const latest = useRef(values);
  useEffect(() => {
    latest.current = values;
  });

  // Otra idea: se vuelve a leer. Es el patron de React para derivar estado de
  // una prop (en vez de un efecto que lo corrija un render despues).
  if (idea && loadedId !== currentId) {
    setLoadedId(currentId);
    setValues(valuesOf(idea));
    setSaveState("idle");
  }

  const ideaId = idea?.id;
  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty.current || !ideaId) return true;
    dirty.current = false;
    setSaveState("saving");

    const v = latest.current;
    const result = await updateIdea(ideaId, {
      title: v.title,
      content: v.content,
      format: v.format,
      reference: v.reference,
      platforms: v.platforms,
      pillar_id: v.pillarId || null,
      offer_id: v.offerId || null,
      funnel_stage: v.funnelStage || null,
    });

    if (!result.ok) {
      dirty.current = true;
      setSaveState("error");
      toast.push({ tone: "error", text: result.error });
      return false;
    }
    setSaveState("saved");
    return true;
  }, [ideaId, toast]);

  // Autoguardado: a los ~1 s de dejar de escribir.
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [values, save]);

  // Lo escrito se guarda tambien si se cierra el drawer (Esc, fondo, atras).
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => () => void saveRef.current(), []);

  function edit(patch: Partial<Values>) {
    dirty.current = true;
    setValues((v) => ({ ...v, ...patch }));
  }

  async function go(id: string | null) {
    if (!id) return;
    if (!(await save())) return;
    onOpenIdea(id);
  }

  async function act(action: GalleryAction) {
    if (!idea) return;
    // Si no se pudo guardar lo escrito, no se decide sobre una version vieja.
    if (!(await save())) return;
    if (action === "discard" && !window.confirm("¿Descartar esta idea? Sale del tablero.")) return;

    setBusy(action);
    const result =
      action === "discard"
        ? await discardIdea(idea.id)
        : await approveIdea(idea.id, { produceCopy: action === "approve_and_generate" });
    setBusy(null);

    if (!result.ok) {
      toast.push({ tone: "error", text: result.error });
      return;
    }

    const data = "data" in result ? result.data : {};
    const step = stepAfter(action, ids, idea.id, data as { postId?: string; copyQueued?: boolean; copyError?: string });
    toast.push(step.toast);

    if (step.kind === "idea") onOpenIdea(step.id);
    else if (step.kind === "piece") onOpenPiece(step.id);
    else onClose();
  }

  // Entre que la idea sale de la lista (recien aprobada o descartada) y que la
  // URL pasa a la siguiente pasan unos milisegundos: se sigue dibujando la
  // ultima conocida, para que el drawer no parpadee ni pierda el foco. Es
  // estado derivado de las props (se guarda en el render solo si cambio), no un
  // ref: leer un ref al dibujar da resultados distintos segun cuando React dibuje.
  const [lastKnown, setLastKnown] = useState<{ idea: BoardIdea; position: GalleryPosition } | null>(null);
  if (idea && position && (lastKnown?.idea !== idea || lastKnown.position.label !== position.label)) {
    setLastKnown({ idea, position });
  }
  const view = idea && position ? { idea, position } : lastKnown;
  if (!view) return null;

  const shown = view.idea;
  const pos = view.position;
  const actions = ideaActions(shown.status, { approve: perms.approve, ai: perms.ai, aiAvailable }, { withDiscard: true });

  return (
    <Drawer
      size="idea"
      label={values.title || shown.title}
      onClose={onClose}
      returnFocus={returnFocus}
      header={
        <>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide">Idea</span>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {pos.label}
          </span>
          <span className="flex-1" />
          <SaveStatus state={saveState} editable={editable} />
          <button
            type="button"
            onClick={() => void go(pos.prevId)}
            disabled={!pos.prevId}
            aria-label="Idea anterior"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void go(pos.nextId)}
            disabled={!pos.nextId}
            aria-label="Idea siguiente"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </>
      }
      footer={
        perms.approve ? (
          <>
            {actions
              .filter((a) => a.action === "discard")
              .map((a) => (
                <button
                  key={a.action}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act("discard")}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm text-destructive hover:bg-accent disabled:opacity-50"
                >
                  {a.label}
                </button>
              ))}
            <span className="flex-1" />
            {actions
              .filter((a) => a.action !== "discard")
              .map((a) => (
                <button
                  key={a.action}
                  type="button"
                  disabled={busy !== null || Boolean(a.disabledReason)}
                  title={a.disabledReason ?? (a.action === "approve_and_generate" ? aiReason : undefined)}
                  onClick={() => void act(a.action)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50",
                    a.action === "approve_and_generate"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border hover:bg-accent",
                  )}
                >
                  {a.action === "approve_and_generate" ? "✦ " : ""}
                  {a.label}
                </button>
              ))}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Solo Owner y Admin deciden sobre las ideas. Lo que edites se guarda.
          </p>
        )
      }
    >
      <div className="space-y-4 p-4">
        <DialogField label="Título">
          <input
            value={values.title}
            onChange={(e) => edit({ title: e.target.value })}
            disabled={!editable}
            maxLength={200}
            className={fieldInput}
          />
        </DialogField>

        <DialogField
          label="Idea / contenido"
          hint="El hook, el ángulo, el desarrollo… todo junto. Al aprobar y producir copy, esto es lo que la IA usa para escribir el guion y los captions."
        >
          <textarea
            value={values.content}
            onChange={(e) => edit({ content: e.target.value })}
            disabled={!editable}
            className={cn(fieldInput, "min-h-[200px]")}
          />
        </DialogField>

        <ClassificationFields
          value={values}
          onChange={(patch) => edit(patch)}
          taxonomy={taxonomy}
          disabled={!editable}
          platforms={{
            available: platforms,
            selected: values.platforms,
            onChange: (next) => edit({ platforms: next }),
          }}
        />

        {!editable && (
          <p className="text-xs text-muted-foreground">
            Esta idea es de otra persona: solo quien aprueba puede editarla.
          </p>
        )}

        {shown.authorship && (
          <p className="text-[11px] text-muted-foreground" data-testid="authorship">
            {shown.authorship}
          </p>
        )}

        {perms.approve && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p>
              <b className="text-foreground">Aprobar</b> crea la pieza en Borrador con el guion vacío y te trae la idea
              siguiente.
            </p>
            <p className="mt-1.5">
              <b className="text-foreground">✦ Aprobar y producir copy</b> le pide a la IA el guion y los captions a
              partir de este texto, y te abre la pieza acá mismo para revisarla.
              {aiAvailable ? "" : ` ${aiReason ?? "Hace falta conectar un proveedor de IA."}`}
            </p>
          </div>
        )}
      </div>
    </Drawer>
  );
}

const EMPTY: BoardIdea = {
  kind: "idea",
  id: "",
  title: "",
  format: null,
  status: "nueva",
  createdBy: null,
  position: 0,
  content: null,
  reference: null,
  platforms: [],
  pillar: null,
  offer: null,
  funnelStage: null,
  createdAt: null,
  updatedAt: null,
  authorName: null,
  authorship: null,
};

function SaveStatus({ state, editable }: { state: "idle" | "saving" | "saved" | "error"; editable: boolean }) {
  if (!editable || state === "idle") return null;
  return (
    <span
      className={cn("text-xs", state === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}
      aria-live="polite"
    >
      {state === "saving" ? "Guardando…" : state === "saved" ? "Guardado" : "No se pudo guardar"}
    </span>
  );
}
