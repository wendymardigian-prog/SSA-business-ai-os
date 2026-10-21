"use client";

import { useMemo } from "react";
import { FileSignature, PenLine } from "lucide-react";
import { RichTextEditor, type RichTextFormat } from "@/components/editor/rich-text-editor";
import { editorDocToMarkdown, markdownToEditorDoc } from "@/lib/forms/contract/editor-markdown";
import { unsupportedPdfChars } from "@/lib/forms/contract/pdf-charset";
import { MAX_CONTRACT_TEXT } from "@/lib/forms/definition-schema";
import { FIXED_VARIABLES, templateVariables, unknownVariables } from "@/lib/forms/contract/variables";
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
  fieldKeys,
}: {
  formId: string;
  title: string;
  text: string;
  onText: (next: string) => void;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
  /** Solo en modo Contrato: las claves de las preguntas (las variables `{{respuesta.<clave>}}`). */
  fieldKeys?: string[];
}) {
  const unsupported = useMemo(() => unsupportedPdfChars(text), [text]);
  const tooLong = text.length > MAX_CONTRACT_TEXT;
  const variables = useMemo(() => (fieldKeys ? [...fieldKeys.map((k) => `respuesta.${k}`), ...FIXED_VARIABLES.map((v) => v.name)] : undefined), [fieldKeys]);
  const unknown = useMemo(() => (fieldKeys ? unknownVariables(text, fieldKeys) : templateVariables(text)), [text, fieldKeys]);
  const usesLinkOnly = useMemo(
    () => (fieldKeys ? templateVariables(text).some((name) => FIXED_VARIABLES.some((v) => v.name === name && v.needsLink)) : false),
    [text, fieldKeys],
  );
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
        variables={variables}
        onChange={onText}
      />
      {unknown.length > 0 && (
        <p role="alert" className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {fieldKeys
            ? `Estas variables no existen (¿una pregunta borrada o mal escrita?): ${unknown.map((n) => `{{${n}}}`).join(", ")}. No se puede publicar así.`
            : `Las variables (${unknown.map((n) => `{{${n}}}`).join(", ")}) solo funcionan en modo Contrato. Cambiá el modo en Aceptación y firma o sacalas del texto.`}
        </p>
      )}
      {usesLinkOnly && (
        <p className="mt-2 text-xs text-muted-foreground">
          Las variables de contacto y de venta se completan cuando el contrato se manda desde una venta (con su link). Si alguien lo abre suelto, ahí aparece «—».
        </p>
      )}
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

/** Cómo se ve la casilla y la firma (o las dos firmas) para quien firma. Un clic abre sus ajustes en el panel. */
export function ContractSigningBlock({
  config,
  selected,
  onSelect,
  signatureUrl,
}: {
  config: ContractConfig;
  selected: boolean;
  onSelect: () => void;
  signatureUrl?: string | null;
}) {
  const both = config.mode === "contract" && config.businessSigner.enabled;
  const personBox = (
    <span className="block">
      <span className="mb-1.5 block text-sm font-medium">
        {both ? "Firma de quien contrata" : "Firma"} {config.signatureRequired ? <span aria-hidden>*</span> : <span className="text-xs font-normal text-muted-foreground">(opcional)</span>}
      </span>
      <span className="flex h-24 items-center justify-center gap-1.5 rounded-lg border border-dashed border-input text-xs text-muted-foreground">
        <PenLine className="h-4 w-4" aria-hidden /> Acá firma la persona
      </span>
    </span>
  );
  return (
    <button type="button" onClick={onSelect} aria-label="Aceptación y firma: abrir los ajustes" className={cn(blockClass(selected), "block w-full space-y-3 bg-background text-left")}>
      <span className="flex items-start gap-2.5 text-sm">
        <span aria-hidden className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded border border-input" />
        <span>{config.acceptLabel}</span>
      </span>
      {both ? (
        <span className="grid gap-3 sm:grid-cols-2">
          <span className="block">
            <span className="mb-1.5 block text-sm font-medium">Por {config.businessSigner.name || "el negocio"}</span>
            <span className="flex h-24 items-center justify-center rounded-lg border border-border bg-white">
              {signatureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- link temporal a un bucket privado
                <img src={signatureUrl} alt="Tu firma" className="h-full w-full object-contain p-1" />
              ) : (
                <span className="text-xs text-muted-foreground">Cargá tu firma en el panel</span>
              )}
            </span>
            {config.businessSigner.role && <span className="mt-1 block text-xs text-muted-foreground">{config.businessSigner.role}</span>}
          </span>
          {personBox}
        </span>
      ) : (
        personBox
      )}
    </button>
  );
}

/** El rótulo de un paso del modo Contrato en el lienzo. */
export function ContractStepLabel({ step, text }: { step: 1 | 2; text: string }) {
  return (
    <p className="flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">{step}</span>
      {text}
    </p>
  );
}
