"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus, Sparkles, Braces, X } from "lucide-react";
import { AiPanel } from "@/components/designer/ai/ai-panel";
import { AutomateModal } from "@/components/designer/automate/automate-modal";
import { CanvasStage, type CanvasHandle } from "@/components/designer/canvas/canvas-stage";
import { ConfigDrawer, type ConfigSubject, type TemplateSettingsState } from "@/components/designer/config/config-drawer";
import { ElementToolbar } from "@/components/designer/element-toolbar/element-toolbar";
import { GenerateManyModal } from "@/components/designer/generate/generate-many-modal";
import { GenerateOneModal } from "@/components/designer/generate/generate-one-modal";
import { GenerationsTab } from "@/components/designer/generate/generations-tab";
import { LayersPanel } from "@/components/designer/layers/layers-panel";
import { PageStrip } from "@/components/designer/pages/page-strip";
import { ExportMenu } from "@/components/designer/publish/export-menu";
import { PublishMenu } from "@/components/designer/publish/publish-menu";
import { UseInContent } from "@/components/designer/content/use-in-content";
import { VariableMenu } from "@/components/designer/variables/variable-menu";
import { VariablesPanel } from "@/components/designer/variables/variables-panel";
import { saveDesignDoc, renameDesign, updateTemplateSettings } from "@/lib/actions/designer/designs";
import type { DesignerCan } from "@/lib/designer/contracts";
import { type DesignDoc, type DesignElement, type HtmlElement, type TextElement } from "@/lib/designer/doc/schema";
import { applyHtmlText } from "@/lib/designer/screens/html-texts";
import type { UploadedFont } from "@/lib/designer/fonts";
import { FORMATS, type FormatKey } from "@/lib/designer/formats";
import type { EditorRecord } from "@/lib/designer/queries";
import { alignElements, addElement, patchElement, patchElements, removeElements, duplicateElements, usedColorsOf, mapPage, type ElementPatch } from "@/lib/designer/screens/doc-ops";
import { convertDocFormat } from "@/lib/designer/screens/format-change";
import { begin, canRedo, canUndo, commit, createHistory, push, redo, undo, type History } from "@/lib/designer/screens/history";
import { commandForKey } from "@/lib/designer/screens/keyboard";
import { applyOrder, orderAvailability, toggleLocked } from "@/lib/designer/screens/layers";
import { aiNoticeText, PANEL_LABELS, panelTabs, parsePanel, type PanelId } from "@/lib/designer/screens/panels";
import { addPage, deletePage, duplicatePage, followSelected, movePage } from "@/lib/designer/screens/pages";
import { hasUnpublishedChanges } from "@/lib/designer/screens/stale";
import { AUTOSAVE_DELAY_MS, hasUnsavedChanges, initialSaveState, isOfflineError, needsSave, saveReducer } from "@/lib/designer/screens/save";
import { clear, EMPTY_SELECTION, selectAll, selectHtmlText, selectOnly, soleSelected, startEditing, stopEditing, type SelectionState } from "@/lib/designer/screens/selection";
import { keyboardNudge } from "@/lib/designer/screens/canvas-session";
import { sheetTabsFor } from "@/lib/designer/screens/element-toolbar";
import { editorActions, type EditorCan } from "@/lib/designer/screens/toolbar";
import { insertVariable, parseText, replaceVariable, serializeText } from "@/lib/designer/screens/variables";
import { DEVICES, mobilePreviewHtml, type Device } from "@/lib/designer/screens/web";
import { ZOOM_LABELS, ZOOM_MODES, type ZoomMode } from "@/lib/designer/screens/zoom";
import { newTextElement, readableTextColor } from "@/lib/designer/screens/starter-docs";
import { sampleValues, variableInfo, type CustomVar } from "@/lib/designer/variables/catalog";
import { cn } from "@/lib/utils";
import { AddPanel } from "./add-panel";
import { BottomSheet } from "./overlays";
import { TopBar } from "./top-bar";
import { useDocFonts } from "./use-fonts";
import { useUrlParam } from "./use-url-param";

export interface DesignEditorProps {
  record: EditorRecord;
  assetUrls: Record<string, string>;
  uploadedFonts: UploadedFont[];
  googleFonts: string[];
  brand: { name: string; colorHex: string | null };
  palette: string[];
  /** El dominio del negocio ya aplicado (nunca el del navegador). */
  links: { link: string; pdfUrl: string } | null;
  can: EditorCan;
  generationsCount: number;
  timeZone: string;
  workspaceName: string;
}

const PANEL_ICON: Record<PanelId, typeof Sparkles> = { ia: Sparkles, agregar: Plus, capas: Layers, variables: Braces };

/** Si el foco está en algo donde se escribe (campos, desplegables, un texto editable): ahí las teclas son del campo. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function DesignEditor(props: DesignEditorProps) {
  const { record, can } = props;
  const router = useRouter();
  const isTemplate = record.kind === "template";
  // Sin `designer.edit`, o con una pieza emitida (una generación), el editor es de solo lectura: no se dibuja ningún control de edición.
  const readOnly = !can.edit || !!record.generation;

  // ─── El documento, con su historial ─────────────────────────────────────
  const [hist, setHistState] = useState<History<DesignDoc>>(() => createHistory(record.doc));
  const histRef = useRef(hist);
  const setHist = useCallback((next: History<DesignDoc>) => {
    histRef.current = next;
    setHistState(next);
  }, []);
  const doc = hist.present;

  const [save, dispatchSave] = useReducer(saveReducer, record.rev, initialSaveState);
  const saveRef = useRef(save);
  saveRef.current = save;
  const [conflict, setConflict] = useState<{ doc: DesignDoc; rev: number } | null>(null);

  const [name, setName] = useState(record.name);
  const [customVars, setCustomVars] = useState<CustomVar[]>(record.customVars);
  const customVarsRef = useRef(customVars);
  const varsDirty = useRef(false);
  const [template, setTemplate] = useState<TemplateSettingsState | null>(
    isTemplate ? { verify: record.verify, docType: record.docType, docTypeLabel: record.docTypeLabel, dateFormat: record.dateFormat, allowDownload: record.allowDownload } : null,
  );
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>(props.assetUrls);
  const [banner, setBanner] = useState<string | null>(null);

  const [pageIndexRaw, setPageIndex] = useState(0);
  const pageIndex = Math.min(pageIndexRaw, doc.pages.length - 1);
  const page = doc.pages[pageIndex];
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [zoom, setZoom] = useState<ZoomMode>("fit");
  const [sample, setSample] = useState(false);
  const [device, setDevice] = useState<Device>("desktop");
  const canvasRef = useRef<CanvasHandle>(null);

  const [panelParam, setPanelParam] = useUrlParam("panel");
  const [configParam, setConfigParam] = useUrlParam("config");
  const [tabParam] = useUrlParam("tab");
  const [fromParam] = useUrlParam("desde");
  const [aiParam, setAiParam] = useUrlParam("ia");
  const panel = parsePanel(panelParam, isTemplate, record.origin, !readOnly);
  const [sheet, setSheet] = useState<PanelId | null>(null);
  const [elementTab, setElementTab] = useState<"style" | "order" | "more">("style");
  const [menu, setMenu] = useState<{ mode: "insert" | "swap"; anchor: { left: number; top: number; bottom: number }; target?: { id: string; index: number; key: string } } | null>(null);
  const [modal, setModal] = useState<"one" | "many" | "automate" | null>(null);

  // ─── Cambios del documento ───────────────────────────────────────────────
  const edit = useCallback(() => dispatchSave({ type: "edit" }), []);

  /** Un cambio suelto: un paso del historial (los de la misma clave y seguidos se juntan) y se marca para guardar. */
  const change = useCallback(
    (update: (d: DesignDoc) => DesignDoc, coalesce?: string) => {
      const before = histRef.current;
      const next = update(before.present);
      if (Object.is(next, before.present)) return;
      setHist(push(before, next, { coalesce }));
      edit();
    },
    [edit, setHist],
  );

  const onGestureStart = useCallback(() => setHist(begin(histRef.current)), [setHist]);
  const onGesturePatch = useCallback(
    (patches: Record<string, ElementPatch>) => setHist(push(histRef.current, patchElements(histRef.current.present, Math.min(pageIndexRef.current, histRef.current.present.pages.length - 1), patches))),
    [setHist],
  );
  const onGestureEnd = useCallback(() => {
    const before = histRef.current;
    const moved = before.transaction !== null && !Object.is(before.transaction.base, before.present);
    setHist(commit(before));
    if (moved) edit();
  }, [edit, setHist]);
  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;

  const patchPage = useCallback((update: (p: typeof page) => typeof page) => change((d) => mapPage(d, pageIndexRef.current, update)), [change]);

  // ─── Guardado automático ─────────────────────────────────────────────────
  const doSave = useCallback(async () => {
    const current = saveRef.current;
    if (!needsSave(current)) return;
    dispatchSave({ type: "start" });
    const sentDoc = histRef.current.present;
    const sentVars = varsDirty.current ? customVarsRef.current : undefined;
    try {
      const result = await saveDesignDoc({ kind: record.kind, id: record.id, doc: sentDoc, rev: current.rev, customVars: sentVars });
      if (result.ok) {
        if (sentVars !== undefined && customVarsRef.current === sentVars) varsDirty.current = false;
        dispatchSave({ type: "saved", rev: result.rev });
      } else if ("conflict" in result && result.conflict) {
        setConflict(result.current);
        dispatchSave({ type: "conflict" });
      } else {
        dispatchSave({ type: "failed", error: result.error, offline: false });
      }
    } catch (error) {
      dispatchSave({ type: "failed", error: "No pudimos guardar. Probá de nuevo.", offline: isOfflineError(error, typeof navigator === "undefined" ? true : navigator.onLine) });
    }
  }, [record.kind, record.id]);

  useEffect(() => {
    if (!needsSave(save)) return;
    const timer = setTimeout(() => void doSave(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [save, doSave]);

  /** Guarda lo pendiente ya mismo (antes de un cambio que reescribe el documento en el servidor). */
  const flush = useCallback(async () => {
    for (let i = 0; i < 3 && needsSave(saveRef.current); i++) await doSave();
  }, [doSave]);

  useEffect(() => {
    const onOnline = () => dispatchSave({ type: "online" });
    const onHide = () => document.visibilityState === "hidden" && needsSave(saveRef.current) && void doSave();
    const onUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges(saveRef.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [doSave]);

  // Si el servidor manda un documento más nuevo (la IA guardó, se restauró una versión) y no hay nada sin guardar, se toma.
  useEffect(() => {
    if (record.rev > saveRef.current.rev && !hasUnsavedChanges(saveRef.current)) {
      setHist(createHistory(record.doc));
      dispatchSave({ type: "reloaded", rev: record.rev });
      setSelection(EMPTY_SELECTION);
    }
  }, [record.rev, record.doc, setHist]);

  const reloadFromServer = useCallback(() => router.refresh(), [router]);

  function reloadAfterConflict() {
    if (!conflict) return;
    setHist(createHistory(conflict.doc));
    dispatchSave({ type: "reloaded", rev: conflict.rev });
    setConflict(null);
    setSelection(EMPTY_SELECTION);
  }

  // ─── Lo que se ve ────────────────────────────────────────────────────────
  useDocFonts(doc, props.uploadedFonts, assetUrls);
  const labelFor = useCallback((key: string) => variableInfo(key, { customVars }).label, [customVars]);
  const values = useMemo(() => (sample ? sampleValues({ customVars, workspaceName: props.workspaceName }) : null), [sample, customVars, props.workspaceName]);
  const usedColors = useMemo(() => usedColorsOf(doc), [doc]);
  const verifyOn = isTemplate ? !!template?.verify : !!record.generation?.verify;

  const selectedEls = page.elements.filter((el) => selection.ids.includes(el.id));
  const sole = soleSelected(selection) ? (page.elements.find((el) => el.id === soleSelected(selection)) ?? null) : null;

  // ─── Acciones sobre el elemento ──────────────────────────────────────────
  const heights = () => canvasRef.current?.measureHeights() ?? {};

  function addEl(el: DesignElement) {
    change((d) => addElement(d, pageIndexRef.current, el));
    setSelection(selectOnly(EMPTY_SELECTION, el.id));
  }

  const patchSole = (patch: ElementPatch) => sole && change((d) => patchElement(d, pageIndex, sole.id, patch), `el:${sole.id}:${Object.keys(patch).join(",")}`);

  function removeSelected() {
    const ids = selectedEls.filter((el) => !el.locked).map((el) => el.id);
    if (ids.length === 0) return;
    change((d) => removeElements(d, pageIndex, ids));
    setSelection(clear(selection));
  }

  function duplicateSelected() {
    const ids = selectedEls.map((el) => el.id);
    const out = duplicateElements(histRef.current.present, pageIndex, ids);
    if (out.ids.length === 0) return;
    change(() => out.doc);
    setSelection({ ids: out.ids, editing: null });
  }

  function changeOrder(action: "front" | "forward" | "backward" | "back") {
    if (!sole) return;
    change((d) => mapPage(d, pageIndex, (p) => ({ ...p, elements: applyOrder(p.elements, sole.id, action) })));
  }

  function textChange(el: TextElement, text: string) {
    change((d) => patchElement(d, pageIndex, el.id, { text }), `texto:${el.id}`);
  }

  /** Un texto de adentro de un HTML cargado: solo cambia esa marca; el servidor vuelve a limpiar todo al guardar. */
  function htmlTextChange(el: HtmlElement, tx: string, text: string) {
    change((d) => {
      const target = d.pages[pageIndex]?.elements.find((e): e is HtmlElement => e.id === el.id && e.type === "html");
      if (!target) return d;
      const next = applyHtmlText(target, tx, text);
      return next === target ? d : mapPage(d, pageIndex, (p) => ({ ...p, elements: p.elements.map((e) => (e.id === el.id ? next : e)) }));
    });
  }

  // Variables: en el cursor del texto que se escribe; o al final del texto elegido; o en un texto nuevo.
  function insertVariableFromMenu(key: string) {
    setMenu(null);
    if (selection.editing && canvasRef.current) {
      canvasRef.current.insertVariable(key);
      return;
    }
    if (sole && sole.type === "text") {
      const result = insertVariable(parseText(sole.text), null, key);
      change((d) => patchElement(d, pageIndex, sole.id, { text: serializeText(result.nodes) }));
      return;
    }
    const color = readableTextColor(page.background.color ?? "#ffffff");
    addEl(newTextElement(doc.format, "title", { text: `{{${key}}}`, color }));
  }

  function swapVariable(key: string | null) {
    const target = menu?.target;
    setMenu(null);
    if (!target) return;
    const el = page.elements.find((e) => e.id === target.id);
    if (!el || el.type !== "text") return;
    const nodes = replaceVariable(parseText(el.text), target.index, key);
    change((d) => patchElement(d, pageIndex, el.id, { text: serializeText(nodes) }));
    setSelection((s) => stopEditing(s));
  }

  function openVariableMenu(anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    setMenu({ mode: "insert", anchor: { left: rect.left, top: rect.top, bottom: rect.bottom } });
  }

  // ─── Páginas ─────────────────────────────────────────────────────────────
  function pageMenu(action: "duplicate" | "delete" | "move-left" | "move-right", index: number) {
    if (action === "duplicate") {
      const out = duplicatePage(histRef.current.present, index);
      change(() => out.doc);
      setPageIndex(out.index);
    } else if (action === "delete") {
      const out = deletePage(histRef.current.present, index);
      change(() => out.doc);
      setPageIndex(out.index);
    } else {
      const to = action === "move-left" ? index - 1 : index + 1;
      const out = movePage(histRef.current.present, index, to);
      change(() => out.doc);
      setPageIndex((cur) => followSelected(cur, index, to));
    }
    setSelection(EMPTY_SELECTION);
  }

  // ─── Formato ─────────────────────────────────────────────────────────────
  async function changeFormat(next: FormatKey) {
    if (next === doc.format) return;
    if (isTemplate) {
      setBanner(null);
      await flush();
      const result = await updateTemplateSettings({ id: record.id, format: next });
      if (!result.ok) return setBanner(result.error);
      if (result.data.notice) {
        setBanner(result.data.notice);
        setTemplate((t) => (t ? { ...t, verify: false } : t));
      }
      reloadFromServer();
      return;
    }
    const converted = convertDocFormat(histRef.current.present, next);
    if (!converted.ok) return setBanner(converted.error);
    change(() => converted.doc);
  }

  async function rename(next: string) {
    const previous = name;
    setName(next);
    const result = await renameDesign({ kind: record.kind, id: record.id, name: next });
    if (!result.ok) {
      setName(previous);
      setBanner(result.error);
    }
  }

  // ─── Teclado ─────────────────────────────────────────────────────────────
  const shortcutsOff = configParam !== null || modal !== null || sheet !== null || conflict !== null || tabParam === "generaciones";
  useEffect(() => {
    if (shortcutsOff) return;
    const onKey = (event: KeyboardEvent) => {
      if (readOnly && event.key !== "Escape") return;
      const typing = isTypingTarget(event.target) || selection.editing !== null;
      const command = commandForKey(event, { typing, hasSelection: selection.ids.length > 0 });
      if (!command) return;
      switch (command.type) {
        case "escape":
          if (menu) setMenu(null);
          else if (selection.editing) setSelection((s) => stopEditing(s));
          else if (!typing) setSelection((s) => clear(s));
          return;
        case "undo":
          event.preventDefault();
          if (canUndo(histRef.current)) {
            setHist(undo(histRef.current));
            edit();
          }
          return;
        case "redo":
          event.preventDefault();
          if (canRedo(histRef.current)) {
            setHist(redo(histRef.current));
            edit();
          }
          return;
        case "select-all":
          event.preventDefault();
          setSelection(selectAll(page.elements.map((el) => ({ id: el.id, box: { x: el.x, y: el.y, w: el.w, h: 1 }, hidden: el.hidden }))));
          return;
        case "nudge": {
          event.preventDefault();
          const patches = keyboardNudge(selectedEls, command.direction, command.big);
          if (Object.keys(patches).length) change((d) => patchElements(d, pageIndex, patches), `nudge:${selection.ids.join(",")}`);
          return;
        }
        case "delete":
          event.preventDefault();
          removeSelected();
          return;
        case "duplicate":
          event.preventDefault();
          duplicateSelected();
          return;
        case "edit-text":
          if (sole) {
            event.preventDefault();
            setSelection((s) => startEditing(s, sole));
          }
          return;
        case "forward":
        case "backward":
        case "front":
        case "back":
          event.preventDefault();
          changeOrder(command.type);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usa lo último de la selección y la página
  }, [shortcutsOff, selection, page, pageIndex, readOnly, menu, edit]);

  // ─── Armado de la pantalla ───────────────────────────────────────────────
  const editorCan: EditorCan = can;
  const actions = editorActions(
    {
      kind: record.kind,
      format: doc.format,
      origin: record.origin,
      published: record.published,
      isGeneration: !!record.generation,
      status: record.status,
      archived: record.archived,
      verify: !!template?.verify,
      docType: template?.docType ?? null,
      docTypeLabel: template?.docTypeLabel ?? null,
      generationsCount: props.generationsCount,
      linkedToContent: !!record.contentPostId,
      contentPostId: record.contentPostId,
      fromPiece: fromParam === "pieza",
    },
    editorCan,
  );
  const showGenerations = isTemplate && tabParam === "generaciones";
  const canvasReadOnly = readOnly || sample;
  const mobilePreview = doc.format === "web" && device === "mobile" ? mobilePreviewHtml(doc, (path) => assetUrls[path] ?? "", values ?? undefined) : null;
  const target = { kind: record.kind, id: record.id } as const;
  const aiNotice = aiNoticeText(aiParam);
  const subject: ConfigSubject = {
    kind: record.kind,
    id: record.id,
    name,
    doc,
    origin: record.origin,
    published: record.published,
    archived: record.archived,
    contentLinked: !!record.contentPostId,
    generationsCount: props.generationsCount,
    generation: record.generation ? { templateId: record.generation.templateId, templateName: record.generation.templateName, subjectLabel: record.generation.subjectLabel } : null,
    template,
  };

  const panelContent = (id: PanelId) => {
    switch (id) {
      case "ia":
        return (
          <AiPanel
            target={target}
            format={doc.format}
            isTemplate={isTemplate}
            currentPage={pageIndex}
            pageCount={doc.pages.length}
            rev={save.rev}
            styleKey={doc.style ?? record.style ?? null}
            // Una pieza emitida (o sin `designer.edit`) es de solo lectura: tampoco se le piden cambios a la IA.
            canEdit={!readOnly}
            onApplied={() => reloadFromServer()}
          />
        );
      case "agregar":
        return (
          <AddPanel
            format={doc.format}
            pageNumber={pageIndex + 1}
            page={page}
            isTemplate={isTemplate}
            readOnly={canvasReadOnly}
            brandColor={props.brand.colorHex}
            palette={props.palette}
            usedColors={usedColors}
            assetUrls={assetUrls}
            onAdd={addEl}
            onPage={patchPage}
            onAssetUrl={(path, url) => setAssetUrls((m) => ({ ...m, [path]: url }))}
            onVariableMenu={openVariableMenu}
          />
        );
      case "capas":
        return (
          <LayersPanel
            page={page}
            pageNumber={pageIndex + 1}
            selectedIds={selection.ids}
            selectedText={selection.text ?? null}
            labelFor={labelFor}
            readOnly={canvasReadOnly}
            onSelectText={(elId, tx) => setSelection((s) => selectHtmlText(s, elId, tx))}
            onEditText={(elId, tx) => {
              const el = page.elements.find((e) => e.id === elId);
              if (el) setSelection((s) => startEditing(selectHtmlText(s, elId, tx), el));
            }}
            onSelect={(elId, additive) => setSelection((s) => (additive ? { ids: s.ids.includes(elId) ? s.ids.filter((x) => x !== elId) : [...s.ids, elId], editing: null } : selectOnly(s, elId)))}
            onChange={(elements) => patchPage((p) => ({ ...p, elements }))}
          />
        );
      case "variables":
        return (
          <VariablesPanel
            doc={doc}
            customVars={customVars}
            verify={verifyOn}
            sample={sample}
            readOnly={readOnly}
            onSample={(on) => {
              setSample(on);
              setSelection(EMPTY_SELECTION);
            }}
            onChangeVars={(list) => {
              customVarsRef.current = list;
              varsDirty.current = true;
              setCustomVars(list);
              edit();
            }}
          />
        );
    }
  };

  const htmlTextEditing = !!sole && sole.type === "html" && selection.editing === sole.id && selection.text?.el === sole.id;
  const elementToolbar = sole && !canvasReadOnly && (
    <ElementToolbar
      element={sole}
      isTemplate={isTemplate}
      readOnly={false}
      labelFor={labelFor}
      googleFonts={props.googleFonts}
      uploadedFonts={props.uploadedFonts}
      brandColor={props.brand.colorHex}
      palette={props.palette}
      usedColors={usedColors}
      order={orderAvailability(page.elements, sole.id)}
      onPatch={patchSole}
      onOrder={changeOrder}
      onAlign={(mode) => change((d) => alignElements(d, pageIndex, [sole.id], mode, heights()))}
      onDuplicate={duplicateSelected}
      onToggleLock={() => patchPage((p) => ({ ...p, elements: toggleLocked(p.elements, sole.id) }))}
      onDelete={removeSelected}
      onDone={() => setSelection(EMPTY_SELECTION)}
      onInsertVariable={openVariableMenu}
      htmlTextEditing={htmlTextEditing}
      onImageUploaded={(file) => setAssetUrls((m) => ({ ...m, [file.path]: file.url }))}
      mode={{ kind: "bar" }}
    />
  );

  const links = props.links;
  const slots = {
    useInContent: <UseInContent designId={record.id} format={doc.format} linkedPostId={record.contentPostId} linkedNetwork={record.contentNetwork} />,
    exportMenu: <ExportMenu target={target} format={doc.format} currentPage={pageIndex} pageCount={doc.pages.length} isTemplate={isTemplate} />,
    publish: (
      <PublishMenu
        designId={record.id}
        format={doc.format}
        published={record.published}
        allowDownload={record.allowDownload}
        allowIndexing={record.allowIndexing}
        links={links}
        can={{ publish: can.publish, generate: can.generate }}
        verification={record.generation?.verify ? { docType: record.generation.docType, docTypeLabel: record.generation.docTypeLabel, status: record.voidInfo?.status ?? "valid" } : null}
        stale={hasUnpublishedChanges({ published: record.published, isGeneration: !!record.generation, serverDiffers: record.publishedDiffers, loadedRev: record.rev, currentRev: save.rev, dirty: hasUnsavedChanges(save) })}
      />
    ),
  };

  const bg = FORMATS[doc.format];

  return (
    // En el celular la barra de paneles (IA / Agregar / Capas) es fija abajo: el editor le deja su alto para no tapar la tira de páginas.
    <div className={cn("flex h-full min-h-0 flex-col", !showGenerations && "max-sm:pb-[calc(3.5rem+env(safe-area-inset-bottom))]")}>
      <TopBar
        actions={actions}
        format={doc.format}
        name={name}
        onRename={(next) => void rename(next)}
        onFormat={(f) => void changeFormat(f)}
        saveStatus={save.status}
        saveError={save.error}
        canUndo={canUndo(hist)}
        canRedo={canRedo(hist)}
        onUndo={() => {
          setHist(undo(histRef.current));
          edit();
        }}
        onRedo={() => {
          setHist(redo(histRef.current));
          edit();
        }}
        onConfig={() => setConfigParam("1")}
        onGenerateOne={() => setModal("one")}
        onGenerateMany={() => setModal("many")}
        onAutomate={() => setModal("automate")}
        primaryLabel={actions.primary.label}
        slots={slots}
        readOnly={readOnly}
      />

      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-bad/40 bg-bad/10 px-4 py-2 text-[13px] text-bad">
          <span className="flex-1">Alguien más cambió este diseño mientras lo editabas. Tus cambios sin guardar no se pisan: recargá para ver lo último.</span>
          <button type="button" onClick={reloadAfterConflict} className="rounded-lg border border-bad/50 bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-accent">
            Recargar
          </button>
        </div>
      )}
      {(banner || aiNotice) && (
        <div role="status" className="flex items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-[13px] text-foreground">
          <span className="flex-1">{banner ?? aiNotice}</span>
          <button
            type="button"
            aria-label="Cerrar el aviso"
            onClick={() => {
              setBanner(null);
              if (aiNotice) setAiParam(null, "replace");
            }}
            className="grid h-6 w-6 place-items-center rounded hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {showGenerations ? (
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          <GenerationsTab templateId={record.id} can={{ generate: can.generate }} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* Panel izquierdo: IA · Agregar · Capas · Variables (en el celular son hojas desde la barra de abajo). */}
          <aside className="hidden min-h-0 flex-col border-r border-border bg-card sm:flex" aria-label="Panel">
            <div role="tablist" aria-label="Panel del editor" className="flex gap-0.5 border-b border-border px-2.5 py-2">
              {panelTabs(isTemplate, !readOnly).map((id) => (
                <button key={id} type="button" role="tab" aria-selected={panel === id} onClick={() => setPanelParam(id, "replace")} className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium", panel === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {PANEL_LABELS[id]}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{panelContent(panel)}</div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col bg-muted" aria-label="Lienzo">
            <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-card px-3 py-1.5">
              <div className="hidden min-w-0 flex-1 sm:block">
                {elementToolbar || (
                  <p className="text-[12.5px] text-muted-foreground">
                    {sample ? "Viendo con datos de ejemplo" : doc.format === "web" ? "Página web" : `Página ${pageIndex + 1} de ${doc.pages.length}`} · {bg.label}
                    {!sample && !readOnly && " · Tocá un elemento para editarlo"}
                  </p>
                )}
              </div>
              <p className="flex-1 text-[12.5px] text-muted-foreground sm:hidden">
                {doc.format === "web" ? "Página web" : `Página ${pageIndex + 1} de ${doc.pages.length}`} · {bg.label}
              </p>
              {isTemplate && !sample && !readOnly && !sole && (
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => openVariableMenu(e.currentTarget)} className="inline-flex h-7 items-center gap-1 rounded-md border border-primary-edge bg-primary/10 px-2 text-xs font-medium text-primary-ink hover:bg-primary/20">
                  {"{ }"} Insertar variable ▾
                </button>
              )}
              {doc.format === "web" && (
                <div role="group" aria-label="Vista" className="inline-flex gap-0.5 rounded-lg border border-border bg-muted p-0.5">
                  {(Object.keys(DEVICES) as Device[]).map((d) => (
                    <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", device === d ? "bg-card shadow-sm" : "text-muted-foreground")}>
                      {DEVICES[d].label}
                    </button>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="sr-only sm:not-sr-only">Zoom</span>
                <select aria-label="Zoom" value={String(zoom)} onChange={(e) => setZoom(e.target.value === "fit" ? "fit" : (Number(e.target.value) as ZoomMode))} className="h-7 rounded-md border border-input bg-background px-1.5 text-xs">
                  {ZOOM_MODES.map((m) => (
                    <option key={String(m)} value={String(m)}>
                      {ZOOM_LABELS[String(m)]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <CanvasStage
              doc={doc}
              pageIndex={pageIndex}
              selection={selection}
              onSelection={setSelection}
              assetUrls={assetUrls}
              uploadedFonts={props.uploadedFonts}
              labelFor={labelFor}
              values={values}
              readOnly={canvasReadOnly}
              zoom={zoom}
              onZoom={setZoom}
              onGestureStart={onGestureStart}
              onGesturePatch={onGesturePatch}
              onGestureEnd={onGestureEnd}
              onTextChange={textChange}
              onHtmlTextChange={htmlTextChange}
              onChipTap={(el, index, rect) => setMenu({ mode: "swap", anchor: { left: rect.left, top: rect.top, bottom: rect.bottom }, target: { id: el.id, index, key: parseText(el.text)[index]?.kind === "var" ? (parseText(el.text)[index] as { key: string }).key : "" } })}
              mobilePreview={mobilePreview}
              handleRef={canvasRef}
            />

            {actions.config.visible && doc.format !== "web" && (
              <PageStrip
                doc={doc}
                current={pageIndex}
                lastQa={record.lastQa}
                assetUrls={assetUrls}
                uploadedFonts={props.uploadedFonts}
                customVars={customVars}
                readOnly={canvasReadOnly}
                onSelect={(i) => {
                  setPageIndex(i);
                  setSelection(EMPTY_SELECTION);
                }}
                onAdd={() => {
                  const out = addPage(histRef.current.present, pageIndex);
                  change(() => out.doc);
                  setPageIndex(out.index);
                  setSelection(EMPTY_SELECTION);
                }}
                onMenu={pageMenu}
                onMove={(from, to) => {
                  const out = movePage(histRef.current.present, from, to);
                  change(() => out.doc);
                  setPageIndex((cur) => followSelected(cur, from, to));
                }}
              />
            )}
          </section>
        </div>
      )}

      {/* Celular: la barra de abajo (IA · Agregar · Capas · Variables) y la hoja del elemento elegido. */}
      {!showGenerations && (
        <>
          {sole && !canvasReadOnly && sheet === null && (
            <div className="fixed inset-x-0 bottom-14 z-40 max-h-[45dvh] overflow-y-auto rounded-t-2xl border border-border bg-background p-3 shadow-xl sm:hidden" role="region" aria-label="Elemento seleccionado">
              <div role="tablist" className="mb-2 flex gap-1 border-b border-border">
                {sheetTabsFor(sole).map((t) => (
                  <button key={t.id} type="button" role="tab" aria-selected={elementTab === t.id} onClick={() => setElementTab(t.id)} className={cn("-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium", elementTab === t.id ? "border-primary-edge" : "border-transparent text-muted-foreground")}>
                    {t.label}
                  </button>
                ))}
              </div>
              <ElementToolbar
                element={sole}
                isTemplate={isTemplate}
                readOnly={false}
                labelFor={labelFor}
                googleFonts={props.googleFonts}
                uploadedFonts={props.uploadedFonts}
                brandColor={props.brand.colorHex}
                palette={props.palette}
                usedColors={usedColors}
                order={orderAvailability(page.elements, sole.id)}
                onPatch={patchSole}
                onOrder={changeOrder}
                onAlign={(mode) => change((d) => alignElements(d, pageIndex, [sole.id], mode, heights()))}
                onDuplicate={duplicateSelected}
                onToggleLock={() => patchPage((p) => ({ ...p, elements: toggleLocked(p.elements, sole.id) }))}
                onDelete={removeSelected}
                onDone={() => setSelection(EMPTY_SELECTION)}
                onInsertVariable={openVariableMenu}
                htmlTextEditing={htmlTextEditing}
                onImageUploaded={(file) => setAssetUrls((m) => ({ ...m, [file.path]: file.url }))}
                mode={{ kind: "sheet", groups: sheetTabsFor(sole).find((t) => t.id === elementTab)?.groups ?? ["style"] }}
              />
            </div>
          )}
          <nav aria-label="Paneles" className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] sm:hidden">
            {panelTabs(isTemplate, !readOnly).map((id) => {
              const Icon = PANEL_ICON[id];
              return (
                <button key={id} type="button" onClick={() => setSheet(id)} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                  {PANEL_LABELS[id]}
                </button>
              );
            })}
          </nav>
          {sheet && (
            <BottomSheet title={PANEL_LABELS[sheet]} label={PANEL_LABELS[sheet]} onClose={() => setSheet(null)}>
              <div className="-mx-4 -my-3">{panelContent(sheet)}</div>
            </BottomSheet>
          )}
        </>
      )}

      {menu && (
        <VariableMenu
          mode={menu.mode}
          currentKey={menu.target?.key}
          customVars={customVars}
          verify={verifyOn}
          anchor={menu.anchor}
          onPick={(key) => (menu.mode === "swap" ? swapVariable(key) : insertVariableFromMenu(key))}
          onRemove={() => swapVariable(null)}
          onCreateOwn={() => {
            setMenu(null);
            setPanelParam("variables", "replace");
            setSheet("variables");
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {configParam !== null && actions.config.visible && (
        <ConfigDrawer
          subject={subject}
          can={can}
          timeZone={props.timeZone}
          brand={props.brand}
          palette={props.palette}
          uploadedFonts={props.uploadedFonts}
          customVars={customVars}
          onClose={() => setConfigParam(null, "replace")}
          beforeServer={flush}
          onFormatChange={(f) => void changeFormat(f)}
          onPages={(update) => change((d) => ({ ...d, pages: update(d.pages) }))}
          onTemplateSettings={setTemplate}
          onReload={reloadFromServer}
          onShowGenerations={() => {
            const url = new URL(window.location.href);
            url.searchParams.set("tab", "generaciones");
            url.searchParams.delete("config");
            window.history.pushState(null, "", url);
            window.dispatchEvent(new Event("designer:url"));
          }}
        />
      )}

      {isTemplate && (
        <>
          <GenerateOneModal templateId={record.id} open={modal === "one"} onClose={() => setModal(null)} />
          <GenerateManyModal templateId={record.id} open={modal === "many"} onClose={() => setModal(null)} />
          <AutomateModal templateId={record.id} open={modal === "automate"} onClose={() => setModal(null)} />
        </>
      )}
    </div>
  );
}
