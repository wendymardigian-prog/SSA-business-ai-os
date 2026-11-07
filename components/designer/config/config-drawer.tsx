"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Archive, Copy, Loader2, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DesignerDrawer, inputClass, secondaryButton } from "@/components/designer/editor/overlays";
import { Switch } from "@/components/ui/switch";
import { archiveDesign, deleteDesign, duplicateDesign, updateTemplateSettings } from "@/lib/actions/designer/designs";
import { automationsUsingTemplate } from "@/lib/actions/designer/automate";
import type { DesignerCan, DesignKind } from "@/lib/designer/contracts";
import type { DesignDoc, DesignPage } from "@/lib/designer/doc/schema";
import type { UploadedFont } from "@/lib/designer/fonts";
import { FORMATS, type FormatKey } from "@/lib/designer/formats";
import { anyImageBackground, currentFit, setFitEverywhere } from "@/lib/designer/screens/background";
import { ARCHIVE_CONFIRM_MESSAGE, configSections, deleteBlockers, FIT_OPTIONS, SECTION_TITLES, showsVerification, type ConfigSectionId } from "@/lib/designer/screens/config";
import { formatChoices } from "@/lib/designer/screens/toolbar";
import { DATE_FORMAT_LABELS, type CustomVar, type DateFormat } from "@/lib/designer/variables/catalog";
import { DOC_TYPES, DOC_TYPE_LABELS, FORMAT_NOT_VERIFIABLE, MAX_DOC_TYPE_LABEL, VERIFY_TOGGLE_LABEL, type DocType } from "@/lib/designer/verification";
import { cn } from "@/lib/utils";
import { VersionsList } from "./versions-list";

export interface TemplateSettingsState {
  verify: boolean;
  docType: DocType | null;
  docTypeLabel: string | null;
  dateFormat: DateFormat;
  allowDownload: boolean;
}

export interface ConfigSubject {
  kind: DesignKind;
  id: string;
  name: string;
  doc: DesignDoc;
  origin: string;
  published: boolean;
  archived: boolean;
  contentLinked: boolean;
  generationsCount: number;
  generation: { templateId: string; templateName: string | null; subjectLabel: string | null } | null;
  template: TemplateSettingsState | null;
}

const kv = "flex items-baseline justify-between gap-3 text-[13px]";

function Section({ id, children }: { id: ConfigSectionId; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-border pb-5 last:border-b-0" aria-labelledby={`cfg-${id}`}>
      <h3 id={`cfg-${id}`} className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {SECTION_TITLES[id]}
      </h3>
      {children}
    </section>
  );
}

/**
 * El drawer de Configuración (F28): formato y medidas, ajuste de la imagen de fondo, marca, formato de fechas, «Al generar»
 * (descarga y verificación, solo en formatos impresos), «Dónde se usa», «Origen» (generaciones), Versiones, Duplicar,
 * Archivar y Borrar. Lo que el permiso no da se OCULTA.
 */
export function ConfigDrawer({
  subject,
  can,
  timeZone,
  brand,
  palette,
  uploadedFonts,
  customVars,
  onClose,
  onFormatChange,
  onPages,
  onTemplateSettings,
  onReload,
  onShowGenerations,
}: {
  subject: ConfigSubject;
  can: DesignerCan;
  timeZone: string;
  brand: { name: string; colorHex: string | null };
  palette: readonly string[];
  uploadedFonts: readonly UploadedFont[];
  customVars: readonly CustomVar[];
  onClose: () => void;
  /** Un diseño cambia de formato acá mismo (se guarda solo); una plantilla lo hace por `updateTemplateSettings`. */
  onFormatChange: (format: FormatKey) => void;
  onPages: (update: (pages: DesignPage[]) => DesignPage[]) => void;
  onTemplateSettings: (next: TemplateSettingsState) => void;
  onReload: () => void;
  onShowGenerations: () => void;
}) {
  const router = useRouter();
  const isTemplate = subject.kind === "template";
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uses, setUses] = useState<{ id: string; name: string; href: string; status: string }[] | null>(null);
  const format = subject.doc.format;
  const settings = subject.template;
  const [typeLabel, setTypeLabel] = useState(settings?.docTypeLabel ?? "");

  const sections = configSections({ kind: subject.kind, isGeneration: !!subject.generation, hasBackgroundImage: anyImageBackground(subject.doc.pages) });
  const blockers = deleteBlockers({
    kind: subject.kind,
    isGeneration: !!subject.generation,
    published: subject.published,
    everPublished: subject.published,
    generationsCount: subject.generationsCount,
    linkedToContent: subject.contentLinked,
    canManage: can.manage,
  });
  const formatLocked = !can.edit || subject.origin === "html" || !!subject.generation || formatChoices(format).length < 2;

  useEffect(() => {
    if (!isTemplate) return;
    let cancelled = false;
    void automationsUsingTemplate({ templateId: subject.id }).then((r) => !cancelled && setUses(r.ok ? r.data : []));
    return () => {
      cancelled = true;
    };
  }, [isTemplate, subject.id]);

  async function saveSettings(patch: Parameters<typeof updateTemplateSettings>[0], next: TemplateSettingsState) {
    setBusy("settings");
    setError(null);
    setNotice(null);
    const result = await updateTemplateSettings(patch);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onTemplateSettings(next);
    if (result.data.notice) setNotice(result.data.notice);
  }

  async function changeFormat(next: FormatKey) {
    if (next === format) return;
    if (!isTemplate) {
      onFormatChange(next);
      return;
    }
    setBusy("settings");
    setError(null);
    setNotice(null);
    const result = await updateTemplateSettings({ id: subject.id, format: next });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.notice) setNotice(result.data.notice);
    if (settings && result.data.notice) onTemplateSettings({ ...settings, verify: false });
    onReload();
  }

  async function duplicate() {
    setBusy("duplicate");
    setError(null);
    const result = await duplicateDesign({ kind: subject.kind, id: subject.id });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    router.push(result.data.href);
  }

  async function archive(confirmUnpublish: boolean) {
    setBusy("archive");
    setError(null);
    const result = await archiveDesign({ kind: subject.kind, id: subject.id, confirmUnpublish, restore: subject.archived });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    if (result.data.needsConfirm) return setConfirmArchive(true);
    router.push(subject.kind === "template" ? "/dashboard/disenos?tab=plantillas" : "/dashboard/disenos");
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    const result = await deleteDesign({ kind: subject.kind, id: subject.id });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    router.push(subject.kind === "template" ? "/dashboard/disenos?tab=plantillas" : "/dashboard/disenos");
  }

  const def = FORMATS[format];

  return (
    <DesignerDrawer title="Configuración" label="Configuración" onClose={onClose}>
      {error && (
        <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
          {notice}
        </p>
      )}

      {sections.map((id) => {
        switch (id) {
          case "format":
            return (
              <Section key={id} id={id}>
                <label className="flex flex-col gap-1 text-[13px]">
                  <span className="text-muted-foreground">Formato</span>
                  {formatLocked ? (
                    <span className="font-medium">
                      {def.label}
                      {subject.origin === "html" ? " · del archivo" : ""}
                    </span>
                  ) : (
                    <select value={format} disabled={busy === "settings"} onChange={(e) => void changeFormat(e.target.value as FormatKey)} className={inputClass}>
                      {formatChoices(format)
                        .filter((key) => !isTemplate || key !== "web")
                        .map((key) => (
                          <option key={key} value={key}>
                            {FORMATS[key].label} · {FORMATS[key].width}×{FORMATS[key].height}
                          </option>
                        ))}
                    </select>
                  )}
                </label>
                {format === "web" ? (
                  <p className={kv}>
                    <span className="text-muted-foreground">Ancho</span>
                    <span>Se adapta al celular</span>
                  </p>
                ) : (
                  <>
                    <p className={kv}>
                      <span className="text-muted-foreground">Medidas</span>
                      <span className="tabular-nums">
                        {def.width} × {def.height} px
                      </span>
                    </p>
                    <p className={kv}>
                      <span className="text-muted-foreground">Páginas</span>
                      <span className="tabular-nums">{subject.doc.pages.length}</span>
                    </p>
                  </>
                )}
                {busy === "settings" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Guardando" />}
              </Section>
            );
          case "fit": {
            const fit = currentFit(subject.doc.pages);
            return (
              <Section key={id} id={id}>
                <div role="group" aria-label="Ajuste de la imagen de fondo" className="inline-flex w-fit gap-0.5 rounded-[9px] border border-border bg-muted p-[3px]">
                  {FIT_OPTIONS.map((o) => (
                    <button key={o.value} type="button" disabled={!can.edit} aria-pressed={fit === o.value} onClick={() => onPages((pages) => setFitEverywhere(pages, o.value))} className={cn("rounded-md px-3 py-1 text-[12.5px] font-medium", fit === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </Section>
            );
          }
          case "brand":
            return (
              <Section key={id} id={id}>
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  {[brand.colorHex, ...palette].filter((c): c is string => !!c).slice(0, 8).map((c) => (
                    <span key={c} className="h-[22px] w-[22px] rounded-md border border-border" style={{ background: c }} title={c} />
                  ))}
                  <span>{brand.name}</span>
                </div>
                <p className="text-xs text-muted-foreground">Viene de Ajustes › Marca. La IA la usa en cada pedido.</p>
              </Section>
            );
          case "dates":
            return settings ? (
              <Section key={id} id={id}>
                <select aria-label="Formato de fechas" value={settings.dateFormat} disabled={!can.edit || busy === "settings"} onChange={(e) => void saveSettings({ id: subject.id, date_format: e.target.value as DateFormat }, { ...settings, dateFormat: e.target.value as DateFormat })} className={inputClass}>
                  {(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map((key) => (
                    <option key={key} value={key}>
                      {DATE_FORMAT_LABELS[key]}
                    </option>
                  ))}
                </select>
              </Section>
            ) : null;
          case "generate":
            return settings ? (
              <Section key={id} id={id}>
                <label className="flex items-center gap-2 text-[13px]">
                  <Switch checked={settings.allowDownload} disabled={!can.edit || busy === "settings"} label="Permitir descargar" onChange={(on) => void saveSettings({ id: subject.id, allow_download: on }, { ...settings, allowDownload: on })} />
                  Las piezas generadas se pueden descargar
                </label>
                {showsVerification(format) ? (
                  <>
                    <label className="flex items-center gap-2 text-[13px]">
                      <Switch
                        checked={settings.verify}
                        disabled={!can.edit || busy === "settings"}
                        label={VERIFY_TOGGLE_LABEL}
                        onChange={(on) => {
                          const type = settings.docType ?? "certificado";
                          void saveSettings(on ? { id: subject.id, verify: true, doc_type: type, doc_type_label: type === "otro" ? settings.docTypeLabel : null } : { id: subject.id, verify: false }, { ...settings, verify: on, docType: on ? type : settings.docType });
                        }}
                      />
                      {VERIFY_TOGGLE_LABEL}
                    </label>
                    {settings.verify && (
                      <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-muted p-2.5">
                        <div role="radiogroup" aria-label="Tipo de documento" className="flex flex-wrap gap-1.5">
                          {DOC_TYPES.map((type) => (
                            <button
                              key={type}
                              type="button"
                              role="radio"
                              aria-checked={settings.docType === type}
                              disabled={!can.edit || busy === "settings"}
                              onClick={() => void saveSettings({ id: subject.id, doc_type: type, doc_type_label: type === "otro" ? typeLabel.trim() || null : null }, { ...settings, docType: type, docTypeLabel: type === "otro" ? typeLabel.trim() || null : null })}
                              className={cn("rounded-full border px-3 py-1 text-[12.5px] font-medium", settings.docType === type ? "border-primary-edge bg-primary/15" : "border-border bg-card hover:bg-accent")}
                            >
                              {DOC_TYPE_LABELS[type]}
                            </button>
                          ))}
                        </div>
                        {settings.docType === "otro" && (
                          <input
                            value={typeLabel}
                            maxLength={MAX_DOC_TYPE_LABEL}
                            placeholder="Cómo se llama (por ejemplo, Credencial)"
                            aria-label="Nombre del documento"
                            disabled={!can.edit}
                            onChange={(e) => setTypeLabel(e.target.value)}
                            onBlur={() => typeLabel.trim() !== (settings.docTypeLabel ?? "") && void saveSettings({ id: subject.id, doc_type: "otro", doc_type_label: typeLabel.trim() || null }, { ...settings, docTypeLabel: typeLabel.trim() || null })}
                            className={inputClass}
                          />
                        )}
                        <p className="text-xs text-muted-foreground">Cada pieza lleva un código y muestra «válido» o «anulado» en su link.</p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{FORMAT_NOT_VERIFIABLE}: la verificación solo existe en los formatos impresos (carta y A4).</p>
                )}
                <p className="text-xs text-muted-foreground">La plantilla no tiene link público; cada pieza generada tiene el suyo.</p>
              </Section>
            ) : null;
          case "uses":
            return (
              <Section key={id} id={id}>
                {uses === null ? (
                  <p className="text-xs text-muted-foreground">Buscando…</p>
                ) : uses.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">Todavía no se usa en ninguna automatización.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {uses.map((u) => (
                      <li key={u.id}>
                        •{" "}
                        <Link href={u.href} className="text-primary-ink hover:underline">
                          Automatización · {u.name}
                        </Link>{" "}
                        <span className="text-xs text-muted-foreground">({u.status === "published" ? "publicada" : "borrador"})</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="w-fit text-[13px] font-medium text-primary-ink hover:underline" onClick={() => { onShowGenerations(); onClose(); }}>
                  Ver las {subject.generationsCount} piezas generadas
                </button>
              </Section>
            );
          case "origin":
            return subject.generation ? (
              <Section key={id} id={id}>
                <p className="text-[13px]">
                  Generado desde{" "}
                  {subject.generation.templateName ? (
                    <Link href={`/dashboard/disenos/t/${subject.generation.templateId}`} className="font-medium text-primary-ink hover:underline">
                      {subject.generation.templateName}
                    </Link>
                  ) : (
                    "una plantilla"
                  )}
                  {subject.generation.subjectLabel ? ` para ${subject.generation.subjectLabel}` : ""}.
                </p>
                <p className="text-xs text-muted-foreground">Es una copia propia: si cambiás la plantilla, esta pieza no cambia. Para actualizarla, «Volver a generar» desde la plantilla.</p>
              </Section>
            ) : null;
          case "versions":
            return (
              <Section key={id} id={id}>
                <VersionsList target={{ kind: subject.kind, id: subject.id }} canEdit={can.edit} timeZone={timeZone} uploadedFonts={uploadedFonts} customVars={customVars} onRestored={onReload} />
              </Section>
            );
          case "more":
            return (
              <Section key={id} id={id}>
                <div className="flex flex-wrap gap-2">
                  {can.edit && (
                    <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => void duplicate()}>
                      {busy === "duplicate" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                      Duplicar
                    </button>
                  )}
                  {can.edit && !subject.generation && (
                    <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => void archive(false)}>
                      {busy === "archive" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
                      {subject.archived ? "Sacar de archivados" : "Archivar"}
                    </button>
                  )}
                </div>
                {can.manage && !subject.generation && (
                  <div className="mt-1 flex flex-col gap-1.5">
                    <button type="button" className={cn(secondaryButton, "w-fit text-bad")} disabled={blockers.length > 0 || busy !== null} onClick={() => setConfirmDelete(true)}>
                      <Trash2 className="h-4 w-4" aria-hidden /> Borrar definitivamente
                    </button>
                    {blockers.length > 0 ? (
                      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                        {blockers.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">Solo se pueden borrar borradores sin uso. Esto no se puede deshacer.</p>
                    )}
                  </div>
                )}
                {subject.generation && <p className="text-xs text-muted-foreground">Una pieza emitida no se archiva ni se borra: si hace falta, se anula desde su plantilla.</p>}
              </Section>
            );
        }
      })}

      <ConfirmDialog
        open={confirmArchive}
        title="¿Archivar este diseño?"
        message={ARCHIVE_CONFIRM_MESSAGE}
        confirmLabel="Despublicar y archivar"
        cancelLabel="Cancelar"
        destructive
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => {
          setConfirmArchive(false);
          void archive(true);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="¿Borrar para siempre?"
        message={`«${subject.name}» se borra definitivamente, con su historial de versiones. No se puede deshacer.`}
        confirmLabel="Borrar"
        cancelLabel="Cancelar"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void remove();
        }}
      />
    </DesignerDrawer>
  );
}
