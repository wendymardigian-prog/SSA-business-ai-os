"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronLeft, HelpCircle, Loader2, MoreHorizontal, Redo2, Settings, Undo2, Zap } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { SAVE_LABELS, type EditorActions } from "@/lib/designer/screens/toolbar";
import { FORMATS, type FormatKey } from "@/lib/designer/formats";
import { SHORTCUTS } from "@/lib/designer/screens/keyboard";
import type { SaveStatus } from "@/lib/designer/screens/save";
import { cn } from "@/lib/utils";
import { inputClass, primaryButton, secondaryButton } from "./overlays";
import { useUrlParam } from "./use-url-param";

const STATUS_TONE: Record<EditorActions["status"]["tone"], string> = {
  ok: "bg-good/15 text-good",
  off: "bg-muted text-muted-foreground",
  pur: "bg-primary/15 text-primary-ink",
  warn: "bg-warn/15 text-warn",
  bad: "bg-bad/15 text-bad",
  act: "bg-primary/15 text-primary-ink",
};

const SAVE_TONE: Record<SaveStatus, string> = {
  saved: "text-muted-foreground",
  saving: "text-muted-foreground",
  dirty: "text-muted-foreground",
  offline: "text-warn",
  conflict: "text-bad",
  error: "text-bad",
};

/**
 * La barra superior del editor (F17, §11.4): volver, el nombre editable en el lugar (guarda al salir del campo), el formato
 * (en cargados de HTML, la etiqueta fija «… · del archivo»), el estado, el indicador de guardado y, a la derecha, lo que
 * toca según el tipo. En el celular: una fila compacta (volver, nombre, ⋯, ⚙) y, abajo, lo demás al tocar «⋯».
 *
 * Lo que decide qué se ve está en `editorActions` (puro): acá solo se acomoda. Los menús de Publicar, Exportar y «Usar en
 * contenido» llegan armados desde sus bloques (`slots`).
 */
export function TopBar({
  actions,
  format,
  name,
  onRename,
  onFormat,
  saveStatus,
  saveError,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onConfig,
  onGenerateOne,
  onGenerateMany,
  onAutomate,
  primaryLabel,
  slots,
  readOnly,
}: {
  actions: EditorActions;
  format: FormatKey;
  name: string;
  onRename: (name: string) => void;
  onFormat: (format: FormatKey) => void;
  saveStatus: SaveStatus;
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onConfig: () => void;
  onGenerateOne: () => void;
  onGenerateMany: () => void;
  onAutomate: () => void;
  primaryLabel: string;
  slots: { useInContent: ReactNode; exportMenu: ReactNode; publish: ReactNode };
  readOnly: boolean;
}) {
  // Mientras se escribe, lo escrito; si no, el nombre guardado (así no hace falta copiarlo con un efecto).
  const [typed, setTyped] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const draft = typed ?? name;

  const commit = () => {
    const clean = draft.replace(/\s+/g, " ").trim();
    setTyped(null);
    if (clean && clean !== name) onRename(clean);
  };

  const saveText = saveStatus === "error" && saveError ? saveError : SAVE_LABELS[saveStatus];

  const formatControl =
    actions.format.mode === "select" ? (
      <select aria-label="Formato" value={format} onChange={(e) => onFormat(e.target.value as FormatKey)} className={cn(inputClass, "h-9 w-auto max-w-[220px]")}>
        {actions.format.options.map((key) => (
          <option key={key} value={key}>
            {FORMATS[key].label} · {FORMATS[key].width}×{FORMATS[key].height}
          </option>
        ))}
      </select>
    ) : (
      <span className="inline-flex h-7 items-center whitespace-nowrap rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground">{actions.format.label}</span>
    );

  const rightButtons = (
    <>
      {actions.useInContent.visible && slots.useInContent}
      {actions.exportMenu.visible && slots.exportMenu}
      {actions.publish.visible && slots.publish}
      {actions.automate.visible && (
        <button type="button" onClick={onAutomate} className={secondaryButton}>
          <Zap className="h-4 w-4" aria-hidden /> Automatizar
        </button>
      )}
      {actions.generateMany.visible && (
        <button type="button" onClick={onGenerateMany} className={secondaryButton}>
          Generar para varios…
        </button>
      )}
      {actions.primary.visible && (
        <button type="button" onClick={onGenerateOne} className={primaryButton}>
          {primaryLabel}
        </button>
      )}
    </>
  );

  return (
    <header className="shrink-0 border-b border-border bg-card">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        <Link href={actions.back.href} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Volver a ${actions.back.label}`}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span className="hidden md:inline">{actions.back.label}</span>
        </Link>
        <input
          value={draft}
          readOnly={readOnly}
          aria-label="Nombre"
          maxLength={200}
          onFocus={() => setTyped(name)}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setTyped(null);
              e.currentTarget.blur();
            }
          }}
          className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-[15px] font-semibold hover:border-border focus:border-primary-edge focus:bg-background focus:outline-none sm:max-w-[360px] sm:flex-none"
        />
        <div className="hidden items-center gap-2 sm:flex">
          {formatControl}
          <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold", STATUS_TONE[actions.status.tone])}>{actions.status.label}</span>
        </div>
        <span role="status" className={cn("hidden items-center gap-1.5 whitespace-nowrap text-xs md:inline-flex", SAVE_TONE[saveStatus])}>
          {saveStatus === "saving" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {saveText}
        </span>
        <div className="flex-1 max-sm:hidden" />
        {!readOnly && (
          <div className="hidden items-center gap-1 sm:flex">
            <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Deshacer (⌘ Z)" title="Deshacer (⌘ Z)" className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-35">
              <Undo2 className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="Rehacer (⌘ ⇧ Z)" title="Rehacer (⌘ ⇧ Z)" className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-35">
              <Redo2 className="h-4 w-4" aria-hidden />
            </button>
            <Popover label="Atajos de teclado" trigger={<HelpCircle className="h-4 w-4" aria-hidden />} panelClassName="w-64 p-3" triggerClassName="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent">
              <ul className="flex flex-col gap-1.5 text-xs">
                {SHORTCUTS.map((s) => (
                  <li key={s.keys} className="flex justify-between gap-3">
                    <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px]">{s.keys}</kbd>
                    <span className="text-muted-foreground">{s.does}</span>
                  </li>
                ))}
              </ul>
            </Popover>
          </div>
        )}
        <div className="hidden items-center gap-2 lg:flex">{rightButtons}</div>
        {actions.config.visible && (
          <button type="button" onClick={onConfig} aria-label="Configuración" title="Configuración" className={cn(secondaryButton, "w-9 px-0")}>
            <Settings className="h-4 w-4" aria-hidden />
          </button>
        )}
        <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} aria-label="Más acciones" className={cn(secondaryButton, "w-9 px-0 lg:hidden")}>
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {actions.tabs && <TemplateTabs tabs={actions.tabs} />}

      {moreOpen && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5 lg:hidden">
          {formatControl}
          <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold sm:hidden", STATUS_TONE[actions.status.tone])}>{actions.status.label}</span>
          <span className={cn("text-xs md:hidden", SAVE_TONE[saveStatus])}>{saveText}</span>
          <span className="flex flex-wrap items-center gap-2">{rightButtons}</span>
        </div>
      )}
    </header>
  );
}

/** Las pestañas Diseño · Generaciones (N) de una plantilla (viven en la URL: `?tab=`). */
function TemplateTabs({ tabs }: { tabs: NonNullable<EditorActions["tabs"]> }) {
  const [tab, setTab] = useUrlParam("tab");
  const current = tab === "generaciones" ? "generaciones" : "diseno";
  return (
    <div role="tablist" aria-label="Plantilla" className="flex gap-1 border-t border-border px-3 sm:px-4">
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={current === item.id}
          onClick={() => setTab(item.id === "diseno" ? null : item.id)}
          className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium", current === item.id ? "border-primary-edge text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
