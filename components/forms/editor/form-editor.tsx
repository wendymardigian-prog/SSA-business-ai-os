"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Notice } from "@/components/agents/fields";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { publishForm, saveFormDraft } from "@/lib/actions/forms/forms";
import { isPublicFormType } from "@/lib/forms/fields";
import { parseEditorTab, type EditorSection, type SaveState } from "@/lib/forms/editor-bar";
import { reconcileContactConfig, type ContactConfig } from "@/lib/forms/contact-config";
import { checkPublishable, contactWarning, hasUnpublishedChanges } from "@/lib/forms/publish";
import { typeChecks } from "@/lib/forms/type-checks";
import { fingerprint } from "@/lib/unsaved-changes";
import { AutomationsTab } from "./automations-tab";
import { ContractEditor } from "./contract-editor";
import { ContactTab } from "./contact-tab";
import { FieldsTab } from "./fields-tab";
import { PublishTab } from "./publish-tab";
import { EditorBar } from "./editor-bar";
import { PreviewOverlay } from "./preview-overlay";
import type { Draft, EditorExtras, EditorForm, EditorVersion } from "./types";
import { EodConfigTab } from "@/components/eod/editor/config-tab";
import { ChannelsTab } from "@/components/eod/editor/channels-tab";
import { EodFieldsEditor } from "@/components/eod/editor/eod-fields-editor";

/**
 * El editor de un formulario (F4, F8). Carcasa: la barra superior (nombre, pestañas, estado, guardado,
 * Métricas, Vista previa y Publicar: `EditorBar`, plano formularios-ui F7), el contenido de la pestaña elegida
 * y el guardado automático del borrador. La pestaña vive en la URL (`?tab=`).
 *
 * El borrador se guarda solo (a los 0,8 s de dejar de escribir). Si alguien más
 * cambió el formulario mientras tanto, el guardado se frena y se avisa: nunca se
 * pisa lo de otra persona sin que lo sepa.
 */

type Section = EditorSection;

export function FormEditor({
  form,
  versions,
  canManage,
  appUrl,
  timeZone,
  extras,
}: {
  form: EditorForm;
  versions: EditorVersion[];
  canManage: boolean;
  appUrl: string;
  timeZone: string;
  extras: EditorExtras;
}) {
  const router = useRouter();
  const isEod = form.type === "eod";
  const [eodConfig, setEodConfig] = useState(form.eodConfig);
  // La pestaña sale de `?tab=` (se puede recargar y compartir). Un valor invalido cae en la primera.
  const searchParams = useSearchParams();
  const section: Section = parseEditorTab(form.type, eodConfig?.variant ?? null, searchParams.get("tab"));
  /** Cambia de pestaña sin recargar ni volver a pedir la pagina: Next sincroniza `useSearchParams` con `pushState`. */
  const setSection = useCallback(
    (next: Section) => {
      const first = parseEditorTab(form.type, eodConfig?.variant ?? null, null);
      window.history.pushState(null, "", next === first ? window.location.pathname : `?tab=${next}`);
    },
    [form.type, eodConfig?.variant],
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ name: form.name, definition: form.draftDefinition, design: form.design, success: form.success });
  const [surveyConfig, setSurveyConfig] = useState(form.surveyConfig);
  const [contractConfig, setContractConfig] = useState(form.contractConfig);
  // El mapeo al contacto vive aparte del borrador pero se guarda JUNTO con él (R4).
  const [contactConfig, setContactConfig] = useState<ContactConfig>(form.contactConfig);
  const contactRef = useRef(contactConfig);
  contactRef.current = contactConfig;
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [slug, setSlug] = useState(form.slug);
  const [status, setStatus] = useState(form.status);
  const [snapshot, setSnapshot] = useState(form.publishedSnapshot);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState<{ tone: "success" | "error"; text: string; reasons?: string[] } | null>(null);
  const [publishing, startPublishing] = useTransition();

  const updatedAt = useRef(form.updatedAt);
  const [savedFp, setSavedFp] = useState(() => fingerprint({ name: form.name, definition: form.draftDefinition, design: form.design, success: form.success, contactConfig: form.contactConfig }));
  const fp = useMemo(() => fingerprint({ ...draft, contactConfig }), [draft, contactConfig]);
  const dirty = fp !== savedFp;
  const inFlight = useRef(false);

  const disabled = !canManage || status === "archived";
  const neverPublished = snapshot === null;

  const save = useCallback(
    async (target: Draft, targetFp: string): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setSaveState("saving");
      setSaveError(null);
      try {
        const result = await saveFormDraft({
          formId: form.id,
          name: target.name,
          definition: target.definition,
          design: target.design,
          success: target.success,
          contactConfig: contactRef.current,
          expectedUpdatedAt: updatedAt.current,
        });
        if (result.ok) {
          updatedAt.current = result.updatedAt;
          setSavedFp(targetFp);
          setSaveState("saved");
          return true;
        }
        setSaveError(result.error);
        setSaveState(result.conflict ? "conflict" : "error");
        return false;
      } catch {
        setSaveError("No se pudo guardar. Reintentá.");
        setSaveState("error");
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [form.id],
  );

  // Guardado automático: a los 0,8 s de la última edición. Con un conflicto no se
  // guarda nada hasta que la persona recargue.
  const conflict = saveState === "conflict";
  useEffect(() => {
    if (disabled || !dirty || conflict) return;
    setSaveState((s) => (s === "saving" ? s : "pending"));
    const timer = window.setTimeout(() => void save(draft, fp), 800);
    return () => window.clearTimeout(timer);
  }, [fp, dirty, disabled, conflict, draft, save]);

  // Avisar antes de cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!dirty || disabled) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, disabled]);

  const check = useMemo(
    () =>
      checkPublishable({
        type: form.type,
        slug,
        definition: draft.definition,
        extraChecks: typeChecks(form.type, { surveyConfig, contractConfig, contactMode: contactConfig.mode, eodConfig }),
      }),
    [form.type, slug, draft.definition, surveyConfig, contractConfig, contactConfig.mode, eodConfig],
  );
  const unpublished = hasUnpublishedChanges(draft.definition, snapshot);
  const reasons = check.ok ? [] : check.reasons;
  const publishBlocked = disabled || publishing || saveState === "conflict";

  /** Guarda lo último que se escribió (si hace falta) y dice si quedó guardado. */
  const ensureSaved = useCallback(async (): Promise<boolean> => (dirty ? save(draft, fp) : true), [dirty, save, draft, fp]);

  /** Los campos cambian: el mapeo al contacto se pone al día solo (campo nuevo → se mapea; borrado → se saca). */
  function changeDraft(next: Draft) {
    if (next.definition.fields !== draft.definition.fields) {
      setContactConfig((current) => reconcileContactConfig(draft.definition.fields, next.definition.fields, current));
    }
    setDraft(next);
  }

  const noContactsWarning = contactWarning(contactConfig, draft.definition.fields);

  /**
   * Publicar. Si falta algo, lleva a Campos (donde se marca lo que falta); sin identificadores en el mapeo (y con el
   * interruptor prendido) primero se pide confirmación.
   */
  function publish() {
    if (reasons.length > 0) {
      setPublishMessage({ tone: "error", text: "Para publicar falta arreglar algo:", reasons });
      setSection("campos");
      return;
    }
    if (noContactsWarning && !confirmingPublish) {
      setConfirmingPublish(true);
      return;
    }
    publishNow();
  }

  function publishNow() {
    setConfirmingPublish(false);
    setPublishMessage(null);
    startPublishing(async () => {
      // Lo último que se escribió tiene que estar guardado ANTES de publicar.
      if (dirty) {
        const saved = await save(draft, fp);
        if (!saved) {
          setPublishMessage({ tone: "error", text: "No pudimos guardar los últimos cambios. Probá de nuevo." });
          return;
        }
      }
      const result = await publishForm(form.id);
      if (result.ok) {
        setStatus("published");
        setSnapshot(draft.definition);
        setPublishMessage({
          tone: "success",
          text: result.changed ? `Publicado: versión ${result.versionNumber}` : "Ya estaba al día: no hay cambios para publicar.",
        });
        router.refresh();
      } else {
        setPublishMessage({ tone: "error", text: result.error, reasons: result.reasons });
      }
    });
  }

  const barForm = {
    id: form.id,
    name: draft.name,
    slug,
    type: form.type,
    status,
    eodVariant: eodConfig?.variant ?? null,
    hasUnpublishedChanges: unpublished,
    responseCount: extras.responseCount,
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorBar
        form={barForm}
        route="editor"
        section={section}
        canManage={canManage}
        saveState={saveState}
        name={draft.name}
        onNameChange={(name) => setDraft({ ...draft, name })}
        onSection={setSection}
        onRetrySave={() => void save(draft, fp)}
        onReload={() => router.refresh()}
        onPreview={() => setPreviewOpen(true)}
        onPublish={publish}
        publishing={publishing}
      />

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {!canManage && <div className="mb-4"><Notice tone="info">Podés ver este formulario, pero solo quien administra formularios puede editarlo.</Notice></div>}
        {status === "archived" && <div className="mb-4"><Notice tone="warning">Este formulario está archivado. Restauralo desde la lista para editarlo.</Notice></div>}
        {saveError && <div className="mb-4"><Notice tone="error">{saveError}</Notice></div>}
        {publishMessage && (
          <div className="mb-4" role="status">
            <Notice tone={publishMessage.tone}>
              {publishMessage.text}
              {publishMessage.reasons && publishMessage.reasons.length > 1 && (
                <ul className="mt-1 list-inside list-disc">
                  {publishMessage.reasons.slice(0, 6).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </Notice>
          </div>
        )}
        {canManage && reasons.length > 0 && section === "publicar" && (
          <div className="mb-4">
            <Notice tone="warning">
              Para publicar falta:
              <ul className="mt-1 list-inside list-disc">
                {reasons.slice(0, 6).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Notice>
          </div>
        )}

        <div>
          <div className="pt-4">
            {isEod && section === "configuracion" ? (
              eodConfig ? (
                <EodConfigTab
                  formId={form.id}
                  config={eodConfig}
                  onSaved={setEodConfig}
                  members={extras.members}
                  roles={extras.roles}
                  success={draft.success}
                  onSuccessChange={(success) => setDraft({ ...draft, success })}
                  disabled={disabled}
                />
              ) : (
                <Notice tone="error">La configuración de este reporte no se pudo leer.</Notice>
              )
            ) : isEod && section === "campos" ? (
              <div className="space-y-3">
                {eodConfig?.variant === "setter" && (
                  <p className="text-xs text-muted-foreground">
                    Estas son las preguntas generales. La pregunta de los canales y las preguntas de cada canal están en la pestaña{" "}
                    <button type="button" className="underline" onClick={() => setSection("canales")}>
                      Canales
                    </button>
                    .
                  </p>
                )}
                <EodFieldsEditor
                  label="Preguntas generales"
                  fields={draft.definition.fields}
                  onChange={(fields) => setDraft({ ...draft, definition: { ...draft.definition, fields } })}
                  disabled={disabled}
                  neverPublished={neverPublished}
                />
              </div>
            ) : isEod && section === "canales" ? (
              <ChannelsTab definition={draft.definition} onChange={(definition) => setDraft({ ...draft, definition })} disabled={disabled} neverPublished={neverPublished} />
            ) : section === "campos" && isPublicFormType(form.type) ? (
              <FieldsTab
                draft={draft}
                onChange={changeDraft}
                disabled={disabled}
                neverPublished={neverPublished}
                slug={slug}
                type={form.type}
                contract={contractConfig}
                contactConfig={contactConfig}
                customFields={extras.customFields}
                onOpenContact={() => setSection("contacto")}
              />
            ) : section === "contrato" && form.type === "contract" && contractConfig ? (
              <ContractEditor form={form} draft={draft} onDraftChange={setDraft} config={contractConfig} onSaved={setContractConfig} canManage={canManage} />
            ) : section === "contacto" ? (
              <ContactTab
                form={{ ...form, contactConfig }}
                draft={draft}
                extras={extras}
                canManage={canManage}
                ensureSaved={ensureSaved}
                onSaved={(config, newUpdatedAt) => {
                  setContactConfig(config);
                  if (newUpdatedAt) updatedAt.current = newUpdatedAt;
                }}
              />
            ) : section === "flows" ? (
              <AutomationsTab form={form} extras={extras} canManage={canManage} />
            ) : (
              <PublishTab
                form={{ ...form, slug, status, contactConfig }}
                versions={versions}
                canManage={canManage}
                appUrl={appUrl}
                published={status === "published"}
                onSlugChanged={setSlug}
                timeZone={timeZone}
                definition={draft.definition}
              />
            )}
          </div>
        </div>
      </div>
      {previewOpen && isPublicFormType(form.type) && (
        <PreviewOverlay
          type={form.type}
          slug={slug}
          formName={draft.name}
          design={draft.design}
          definition={draft.definition}
          success={draft.success}
          contract={contractConfig ? { title: contractConfig.title, acceptLabel: contractConfig.acceptLabel, signatureRequired: contractConfig.signatureRequired } : null}
          onClose={() => setPreviewOpen(false)}
        />
      )}
      <ConfirmDialog
        open={confirmingPublish}
        title="Publicar sin contactos"
        message={noContactsWarning ?? ""}
        confirmLabel="Publicar igual"
        cancelLabel="Ir a Contacto"
        onConfirm={publishNow}
        onCancel={() => {
          setConfirmingPublish(false);
          setSection("contacto");
        }}
      />
    </div>
  );
}
