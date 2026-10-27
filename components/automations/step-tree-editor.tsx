"use client";

/**
 * El editor de pasos de una automatizacion (reemplaza al editor lineal
 * Cuando / Si / Entonces, y es COMPARTIDO: lo usan Formularios y la Agenda con
 * sus propias variables, su descripcion del disparador y sus acciones).
 *
 *   Cuando <disparador>            fijo
 *   Solo si…                       solo Formularios: decide si el flujo arranca
 *   Paso 1, paso 2...              uno debajo del otro, con "+ Agregar paso"
 *   Condiciones                    un bloque por camino y "Si no" al final
 *
 * No es el canvas. Es la misma informacion leida como un arbol de pasos
 * (`lib/automations/step-tree.ts`). Si el flujo no es un arbol (caminos que se
 * vuelven a juntar, un A/B, un ciclo, mas de 3 niveles) esto es de solo lectura
 * con "Abrir en el canvas": guardar desde una vista simplificada borraria lo que
 * no se ve.
 *
 * Todo lo que decide algo vive en `lib/automations/`; esto compone.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Notice } from "@/components/agents/fields";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { StepList } from "@/components/automations/step-list";
import { StepEditorProvider, type ConfirmRequest } from "@/components/automations/step-tree-context";
import { useConditionCatalog } from "@/components/automations/use-condition-catalog";
import { TestConditionsButton, type TestResponsesSource } from "@/components/automations/test-conditions-sheet";
import { VisibilityRuleBuilder } from "@/components/forms/builder/visibility-rule-builder"; // @plantilla-quitar(formularios)
import type { ConditionSource } from "@/lib/forms/visibility-builder-adapter"; // @plantilla-quitar(formularios)
// @plantilla-sin(formularios): type ConditionSource = unknown;
import type { VisibilityConfig } from "@/lib/forms/visibility-types"; // @plantilla-quitar(formularios)
// @plantilla-sin(formularios): type VisibilityConfig = unknown;
import { recognizedFields } from "@/lib/automations/condition-builder-model";
import type { EditorScreen } from "@/lib/automations/step-catalog";
import { actionTypeOf, allSteps, firstEmailStep, type ActionStep, type StepTree } from "@/lib/automations/step-tree";
import { ROOT, conditionGroupsFor } from "@/lib/automations/step-tree-edit";
import { treeConditionProblems } from "@/lib/automations/step-tree-problems";
import { loadFlowCapabilities } from "@/lib/actions/flow-capabilities";
import { ALL_CONNECTED, type Capabilities } from "@/lib/flow-engine/node-requirements";

export type EditorActionResult = { ok: true } | { ok: false; error: string };

export interface StepTreeEditorProps {
  screen: EditorScreen;
  /** El link de "volver" del encabezado (ya armado por quien lo usa). */
  backHref: ReactNode;
  /** La ruta del encabezado (`PAGE_META`), para el titulo y el tooltip. */
  routeForHeader: string;
  flowId: string;
  flowName: string;
  /** null = el flujo no es un arbol y solo se puede abrir en el canvas. */
  tree: StepTree | null;
  /** El disparador guardado (para decirlo en palabras aunque el flujo no sea un arbol). */
  trigger: { type: string; config: Record<string, unknown> };
  enabled: boolean;
  /** A cuantas cosas alcanzaria hoy (reuniones), si el modulo lo calcula. */
  reach?: number | null;
  describeReach?: (reach: number) => string;
  /** Las variables que se pueden escribir entre llaves, sin las llaves (`booking.start_invitee`). */
  variableKeys: string[];
  /** Un ejemplo para la ayuda de variables. */
  variableExample: string;
  describeTrigger: (type: string, config: Record<string, unknown>) => string;
  /** Solo Formularios: el "Solo si…" del disparador (`answer_conditions`). */
  onlyIf?: { sources: ConditionSource[]; value: VisibilityConfig | undefined };
  onSave: (input: { flowId: string; tree: Pick<StepTree, "steps">; answerConditions?: VisibilityConfig | null }) => Promise<EditorActionResult>;
  onSendTest: (input: { flowId: string; subject: string; body: string }) => Promise<EditorActionResult>;
  /** Para "Probar condiciones" con una respuesta real (hoy solo Formularios). Sin esto se prueba cargando los datos a mano. */
  testResponses?: TestResponsesSource;
  /** Las personas del equipo, para los pasos que van a gente del equipo (EOD). */
  members?: Array<{ userId: string; name: string }>;
  /** Algo más dentro de "Cuándo" (EOD: primer envío o cada corrección). */
  whenExtra?: ReactNode;
}

const HELP_KEY = "ssa:step-tree-help-seen";

function readHelpSeen(): boolean {
  try {
    return window.localStorage.getItem(HELP_KEY) === "1";
  } catch {
    // Navegador con el almacenamiento bloqueado: se muestra la ayuda y listo.
    return false;
  }
}

function rememberHelpSeen() {
  try {
    window.localStorage.setItem(HELP_KEY, "1");
  } catch {
    // Sin almacenamiento no se recuerda; no pasa nada.
  }
}

const subscribeToStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

const snapshot = (tree: StepTree | null, onlyIf: VisibilityConfig | undefined) => JSON.stringify([tree?.steps ?? null, onlyIf ?? null]);

export function StepTreeEditor({
  screen,
  backHref,
  routeForHeader,
  flowId,
  flowName,
  tree: initialTree,
  trigger,
  enabled,
  reach = null,
  describeReach,
  variableKeys,
  variableExample,
  describeTrigger,
  onlyIf,
  onSave,
  onSendTest,
  testResponses,
  members = [],
  whenExtra,
}: StepTreeEditorProps) {
  const router = useRouter();
  const [tree, setTree] = useState<StepTree | null>(initialTree);
  // Las conexiones del negocio (G1). Se piden al abrir; mientras llegan (o si falla) todo se ve habilitado, como antes.
  const [capabilities, setCapabilities] = useState<Capabilities>(ALL_CONNECTED);
  useEffect(() => {
    let alive = true;
    loadFlowCapabilities()
      .then((loaded) => {
        if (alive && loaded) setCapabilities(loaded);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [onlyIfValue, setOnlyIfValue] = useState<VisibilityConfig | undefined>(onlyIf?.value);
  const [saved, setSaved] = useState(() => snapshot(initialTree, onlyIf?.value));
  const [savedOnlyIf, setSavedOnlyIf] = useState<VisibilityConfig | undefined>(onlyIf?.value);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ request: ConfirmRequest; onConfirm: () => void } | null>(null);
  // En el servidor se da por vista (no hay navegador que leer): evita mostrarla un instante de mas.
  const helpSeenBefore = useSyncExternalStore(subscribeToStorage, readHelpSeen, () => true);
  const [helpDismissed, setHelpDismissed] = useState(false);
  const helpSeen = helpSeenBefore || helpDismissed;
  const [pending, start] = useTransition();

  const { inputs: catalog, error: catalogError } = useConditionCatalog(flowId);

  const readOnly = tree === null;
  const dirty = snapshot(tree, onlyIfValue) !== saved;
  const hasBranch = useMemo(() => (tree ? allSteps(tree).some((s) => s.kind === "branch") : false), [tree]);
  const emailStep = tree ? firstEmailStep(tree) : undefined;
  const emailCount = tree ? allSteps(tree).filter((s) => s.kind === "action" && actionTypeOf(s) === "send_email").length : 0;

  const edit = useCallback((fn: (t: StepTree) => StepTree) => setTree((t) => (t ? fn(t) : t)), []);
  const announce = useCallback((text: string) => setNotice({ kind: "info", text }), []);
  const ask = useCallback((request: ConfirmRequest, onConfirm: () => void) => setConfirm({ request, onConfirm }), []);

  const runTest = useCallback(
    (step: ActionStep) => {
      setNotice(null);
      start(async () => {
        const result = await onSendTest({ flowId, subject: String(step.data.subject ?? ""), body: String(step.data.body ?? "") });
        setNotice(result.ok ? { kind: "ok", text: "Te mandé la prueba a tu email." } : { kind: "error", text: result.error });
      });
    },
    [flowId, onSendTest],
  );

  function save() {
    if (!tree) return;
    setNotice(null);

    // Una condicion a medio armar nunca se cumple: se frena antes de guardar, diciendo cual.
    if (catalog) {
      const problems = treeConditionProblems(tree, (id) => recognizedFields(conditionGroupsFor(tree, id, catalog)));
      if (problems.length > 0) {
        setNotice({ kind: "error", text: problems.length > 1 ? `${problems[0].message} (y ${problems.length - 1} más)` : problems[0].message });
        return;
      }
    }

    const onlyIfChanged = JSON.stringify(onlyIfValue ?? null) !== JSON.stringify(savedOnlyIf ?? null);
    start(async () => {
      const result = await onSave({ flowId, tree: { steps: tree.steps }, ...(onlyIf && onlyIfChanged ? { answerConditions: onlyIfValue ?? null } : {}) });
      if (result.ok) {
        setSaved(snapshot(tree, onlyIfValue));
        setSavedOnlyIf(onlyIfValue);
        setNotice({ kind: "ok", text: "Guardado" });
        router.refresh();
      } else {
        setNotice({ kind: "error", text: result.error });
      }
    });
  }

  const context = tree
    ? {
        screen,
        tree,
        edit,
        disabled: pending,
        catalog,
        sendStepTest: runTest,
        canSendTest: !pending,
        announce,
        ask,
        members,
        variableKeys,
        capabilities,
      }
    : null;

  const canvasHref = `/dashboard/flows/${flowId}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route={routeForHeader}
        title={flowName}
        backHref={backHref}
        left={
          <span
            className={
              enabled
                ? "rounded-full bg-green-500/12 px-2.5 py-0.5 text-xs text-green-600 dark:text-green-300"
                : "rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
            }
          >
            {enabled ? "Encendido" : "Apagado"}
          </span>
        }
        right={
          <Link
            href={canvasHref}
            onClick={(event) => {
              // Con cambios sin guardar, irse al canvas los perderia: se pregunta antes.
              if (!dirty) return;
              event.preventDefault();
              ask({ title: "Hay cambios sin guardar", message: "Si abrís el canvas ahora, se pierden los cambios que hiciste acá.", confirmLabel: "Abrir igual" }, () => router.push(canvasHref));
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Abrir en el canvas
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        {notice && <Notice tone={notice.kind === "ok" ? "success" : notice.kind === "error" ? "error" : "info"}>{notice.text}</Notice>}

        {readOnly && (
          <Notice tone="info">
            Esta automatización tiene una estructura que no se puede editar como lista de pasos (caminos que se vuelven a juntar, un A/B, un ciclo o más de 3 niveles de Condiciones). Abrila en el canvas.
          </Notice>
        )}

        {catalogError && !readOnly && <Notice tone="warning">{catalogError} Podés seguir editando, pero no se van a ofrecer los campos para armar Condiciones.</Notice>}

        <section className="rounded-xl border border-border p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cuándo</h2>
          <p className="mt-1 text-sm">{describeTrigger(trigger.type, trigger.config)}</p>
          {whenExtra}
          {screen === "eod" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Este flujo es sobre una persona del equipo, no sobre un contacto: no puede mandar mensajes por chat ni tocar contactos.
            </p>
          )}
          {reach !== null && describeReach && <p className="mt-1 text-xs text-muted-foreground">{describeReach(reach)}</p>}
        </section>

        {/* @plantilla-desde(formularios) */}
        {onlyIf && !readOnly && (
          <section className="rounded-xl border border-border p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Solo si…</h2>
            <div className="mt-2">
              {onlyIf.sources.length === 0 ? (
                <p className="text-xs text-muted-foreground">Este formulario todavía no tiene preguntas publicadas: publicalo para armar condiciones sobre las respuestas.</p>
              ) : (
                <VisibilityRuleBuilder value={onlyIfValue} onChange={setOnlyIfValue} sources={onlyIf.sources} emptyHint="Sin condiciones: arranca con cualquier respuesta." leadLabel="Arrancar si" />
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Si no se cumple, el flujo no arranca. Para hacer cosas distintas según la respuesta, usá el paso Condiciones.
            </p>
          </section>
        )}
        {/* @plantilla-hasta(formularios) */}

        {context && tree && (
          <StepEditorProvider value={context}>
            <section className="space-y-3 rounded-xl border border-border p-4">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pasos</h2>

              {hasBranch && !helpSeen && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <p className="flex-1">
                    Cada camino termina en sí mismo: lo que viene después de Condiciones va adentro de un camino. Para repetir un paso en varios caminos, usá «Duplicar paso» en su menú.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      rememberHelpSeen();
                      setHelpDismissed(true);
                    }}
                    className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-accent"
                  >
                    Entendido
                  </button>
                </div>
              )}

              <StepList steps={tree.steps} listRef={ROOT} emptyText="Esta automatización no hace nada todavía." />
            </section>
          </StepEditorProvider>
        )}

        <section className="rounded-xl border border-border p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Variables</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Se reemplazan al enviar. Escribilas entre llaves dobles, por ejemplo <code>{`{{${variableExample}}}`}</code>.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {variableKeys.map((key) => (
              <li key={key}>
                <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{`{{${key}}}`}</code>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Guardando…" : "Guardar"}
            </button>
          )}
          {emailStep && (
            <button
              type="button"
              onClick={() => runTest(emailStep)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
            >
              <Send className="h-4 w-4" aria-hidden /> Enviarme una prueba
            </button>
          )}
          {tree && hasBranch && <TestConditionsButton flowId={flowId} tree={tree} catalog={catalog} source={testResponses} disabled={pending} />}
          {dirty && !pending && <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Cambios sin guardar</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          La prueba va solo a tu email, con datos de ejemplo. No le llega a ningún contacto ni cuenta en su historial.
          {emailCount > 1 && " «Enviarme una prueba» manda el primer email; cada email tiene su propio «Enviarme este email» en su menú."}
        </p>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.request.title ?? ""}
        message={confirm?.request.message ?? ""}
        confirmLabel={confirm?.request.confirmLabel ?? "Confirmar"}
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          const run = confirm?.onConfirm;
          setConfirm(null);
          run?.();
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
