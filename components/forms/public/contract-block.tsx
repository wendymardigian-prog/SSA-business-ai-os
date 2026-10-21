"use client";

import { Fragment, type ReactNode } from "react";
import { renderContractMarkdown, type InlineRun } from "@/lib/forms/contract/markdown";
import { SignatureCanvas } from "./signature-canvas";

/**
 * Lo propio de un contrato en la página pública (F24, F25): el texto en un recuadro
 * con scroll, la casilla de aceptación (siempre obligatoria) y la firma.
 *
 * El texto se dibuja con el MISMO `renderContractMarkdown` que usa el PDF, y sin HTML
 * crudo: son nodos de React (que escapan todo), así que un `<script>` en el contrato
 * es una frase más.
 */

function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((run, index) => {
        const lines = run.text.split("\n");
        const content = lines.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {line}
          </Fragment>
        ));
        let node: ReactNode = content;
        if (run.italic) node = <em>{node}</em>;
        if (run.bold) node = <strong>{node}</strong>;
        // `href` ya pasó `safeHref` (solo http, https, mailto y tel): nunca un `javascript:`.
        if (run.href) {
          node = (
            <a href={run.href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2">
              {node}
            </a>
          );
        }
        return <Fragment key={index}>{node}</Fragment>;
      })}
    </>
  );
}

export function ContractText({ text }: { text: string }) {
  const blocks = renderContractMarkdown(text);
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h2 key={index} className="pt-1 text-lg font-bold">
                <Runs runs={block.runs} />
              </h2>
            );
          }
          if (block.level === 2) {
            return (
              <h3 key={index} className="pt-1 text-base font-semibold">
                <Runs runs={block.runs} />
              </h3>
            );
          }
          return (
            <h4 key={index} className="pt-1 text-sm font-semibold">
              <Runs runs={block.runs} />
            </h4>
          );
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={index} className={`space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
              {block.items.map((item, i) => (
                <li key={i}>
                  <Runs runs={item} />
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={index}>
            <Runs runs={block.runs} />
          </p>
        );
      })}
    </div>
  );
}

/** El título y el texto del contrato, en un recuadro con scroll. Va ARRIBA, antes de los campos. */
export function ContractReader({ title, text }: { title: string | null | undefined; text: string }) {
  return (
    <section className="space-y-3" aria-label="Contrato">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      <div
        tabIndex={0}
        role="region"
        aria-label="Texto del contrato"
        className="max-h-[360px] overflow-y-auto rounded-lg border border-border bg-card p-4 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {text.trim() ? <ContractText text={text} /> : <p className="text-sm text-muted-foreground">Este contrato todavía no tiene texto.</p>}
      </div>
    </section>
  );
}

/**
 * La casilla de aceptación (siempre obligatoria) y la firma. Va ABAJO, después de los campos. Con la firma de ambas
 * partes (modo Contrato), la del negocio va al lado, ya estampada.
 */
export function ContractSigning({
  businessSigner,
  acceptLabel,
  signatureRequired,
  accepted,
  onAccepted,
  onSignature,
  acceptedError,
  signatureError,
  disabled,
}: {
  businessSigner?: { name: string; role?: string | null; signature_url?: string | null } | null;
  acceptLabel: string;
  signatureRequired: boolean;
  accepted: boolean;
  onAccepted: (value: boolean) => void;
  onSignature: (dataUrl: string | null, strokes: number) => void;
  acceptedError?: string;
  signatureError?: string;
  disabled?: boolean;
}) {
  return (
    <section className="@container space-y-4" aria-label="Aceptación y firma">
      <div>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" checked={accepted} onChange={(e) => onAccepted(e.target.checked)} disabled={disabled} className="mt-0.5 h-4 w-4 flex-shrink-0" aria-invalid={!!acceptedError} />
          <span>{acceptLabel}</span>
        </label>
        {acceptedError && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {acceptedError}
          </p>
        )}
      </div>

      {/* Lado a lado solo si el FORMULARIO es ancho (no la pantalla): en un embed angosto o un teléfono, una abajo de la otra. */}
      <div className={businessSigner ? "grid gap-4 @lg:grid-cols-2" : undefined}>
        {businessSigner && (
          <div>
            <p className="mb-2 text-sm font-medium">Por {businessSigner.name}</p>
            <div className="flex h-[120px] items-center justify-center rounded-lg border border-border bg-white">
              {businessSigner.signature_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- link temporal a un bucket privado
                <img src={businessSigner.signature_url} alt={`Firma de ${businessSigner.name}`} className="h-full w-full object-contain p-2" />
              ) : (
                <span className="text-xs text-muted-foreground">Firma del negocio</span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {businessSigner.name}
              {businessSigner.role ? ` · ${businessSigner.role}` : ""}
            </p>
          </div>
        )}
        <div>
          <p className="mb-2 text-sm font-medium">
            {businessSigner ? "Tu firma" : "Firma"} {signatureRequired ? <span aria-hidden="true">*</span> : <span className="text-xs font-normal text-muted-foreground">(opcional)</span>}
          </p>
          <SignatureCanvas onChange={onSignature} disabled={disabled} invalid={!!signatureError} />
          {signatureError && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {signatureError}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
