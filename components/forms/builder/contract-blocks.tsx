"use client";

import { useMemo } from "react";
import { FileSignature, PenLine } from "lucide-react";
import { RichTextEditor, type RichTextFormat } from "@/components/editor/rich-text-editor";
import { editorDocToMarkdown, markdownToEditorDoc } from "@/lib/forms/contract/editor-markdown";
import { unsupportedPdfChars } from "@/lib/forms/contract/pdf-charset";
import { MAX_CONTRACT_TEXT } from "@/lib/forms/definition-schema";
import type { ContractConfig } from "@/lib/forms/contract/config";
import { cn } from "@/lib/utils";

/**
 * Los dos bloques propios de un contrato en el lienzo de Diseño: el TEXTO (con el editor con formato, escrito en el
 * lugar) y la ACEPTACIÓN Y FIRMA (una vista de cómo lo ve quien firma; se configura en el panel). Solo dibujan.
 */

/** El contrato se guarda en Markdown acotado: el editor lo abre y lo vuelve a armar (constante: no cambia entre dibujos). */
const CONTRACT_FORMAT: RichTextFormat = { load: markdownToEditorDoc, save: editorDocToMarkdown };

const blockClass = (selected: boolean) =>
  cn("rounded-xl border p-3 transition-colors", selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40");

export function ContractTextBlock({
  formId,
  title,
  text,
  onText,
  selected,
  onSelect,
  disabled,
}: {
  formId: string;
  title: string;
  text: string;
  onText: (next: string) => void;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  const unsupported = useMemo(() => unsupportedPdfChars(text), [text]);
  const tooLong = text.length > MAX_CONTRACT_TEXT;
  return (
    <section aria-label="Texto del contrato" onClick={onSelect} onFocusCapture={onSelect} className={blockClass(selected)}>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <FileSignature className="h-3.5 w-3.5" aria-hidden /> {title || "Contrato"} · el texto que se firma
      </p>
      <RichTextEditor
        id={`contract-text-${formId}`}
        label="Texto del contrato"
        value={text}
        disabled={disabled}
        minHeight={240}
        format={CONTRACT_FORMAT}
        underline={false}
        emoji={false}
        onChange={onText}
      />
      {unsupported.length > 0 && (
        <p role="status" className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          Estos símbolos no se pueden escribir en el PDF y van a salir como «?»: {unsupported.slice(0, 8).join(" ")}. Sacalos del texto.
        </p>
      )}
      {tooLong && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          El texto es demasiado largo ({text.length.toLocaleString("es")} de {MAX_CONTRACT_TEXT.toLocaleString("es")} caracteres).
        </p>
      )}
    </section>
  );
}

/** Cómo se ve la casilla y la firma para quien firma. Un clic abre sus ajustes en el panel. */
export function ContractSigningBlock({ config, selected, onSelect }: { config: ContractConfig; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} aria-label="Aceptación y firma: abrir los ajustes" className={cn(blockClass(selected), "block w-full space-y-3 bg-background text-left")}>
      <span className="flex items-start gap-2.5 text-sm">
        <span aria-hidden className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded border border-input" />
        <span>{config.acceptLabel}</span>
      </span>
      <span className="block">
        <span className="mb-1.5 block text-sm font-medium">
          Firma {config.signatureRequired ? <span aria-hidden>*</span> : <span className="text-xs font-normal text-muted-foreground">(opcional)</span>}
        </span>
        <span className="flex h-24 items-center justify-center gap-1.5 rounded-lg border border-dashed border-input text-xs text-muted-foreground">
          <PenLine className="h-4 w-4" aria-hidden /> Acá firma la persona
        </span>
      </span>
    </button>
  );
}
