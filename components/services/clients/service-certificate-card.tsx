"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueCertificate, reissueCertificate, voidCertificate } from "@/lib/actions/service-certificates";
import { CERTIFICATE_STATUS_LABEL } from "@/lib/services/certificate";
import { cn } from "@/lib/utils";

export interface CertificateView {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  link: string | null;
  pdfUrl: string | null;
}

/**
 * El certificado del servicio en su ficha (F67, F69): el vigente con su link público (el del Diseñador, con el dominio
 * de los links del negocio), Emitir, Anular (motivo) y Volver a emitir; y los anteriores.
 */
export function ServiceCertificateCard({
  serviceId,
  current,
  previous,
  hasStep,
  canIssue,
  canVoid,
  formatDate,
}: {
  serviceId: string;
  current: CertificateView | null;
  previous: CertificateView[];
  hasStep: boolean;
  canIssue: boolean;
  canVoid: boolean;
  formatDate: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "No se pudo hacer");
      router.refresh();
    });
  const askReason = (verb: string) => {
    const r = prompt(`¿Por qué se ${verb} el certificado?`);
    return r && r.trim() ? r.trim() : null;
  };
  if (!current && previous.length === 0 && !hasStep) return null;
  return (
    <section aria-labelledby="certificado" className="space-y-2 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="certificado" className="text-sm font-semibold">Certificado</h3>
        <span className="flex-1" />
        {!current && canIssue && hasStep && (
          <button type="button" disabled={pending} onClick={() => run(() => issueCertificate(serviceId))} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
            Emitir certificado
          </button>
        )}
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {current ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className={cn("rounded px-1.5 py-0.5 text-xs", current.status === "ready" ? "bg-good/15 text-foreground" : "bg-muted text-muted-foreground")}>{CERTIFICATE_STATUS_LABEL[current.status] ?? current.status}</span>
          <span className="font-mono text-xs">{current.code}</span>
          <span className="text-xs text-muted-foreground">{formatDate[current.id]}</span>
          {current.link && current.status === "ready" && (
            <a href={current.link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-ink hover:underline">Ver</a>
          )}
          {current.pdfUrl && current.status === "ready" && (
            <a href={current.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-ink hover:underline">Descargar PDF</a>
          )}
          <span className="flex-1" />
          {canVoid && current.status === "ready" && (
            <button type="button" disabled={pending} onClick={() => { const r = askReason("anula"); if (r) run(() => voidCertificate(serviceId, r)); }} className="rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-accent">
              Anular
            </button>
          )}
          {canVoid && canIssue && current.status === "ready" && (
            <button type="button" disabled={pending} onClick={() => { const r = askReason("vuelve a emitir"); if (r) run(() => reissueCertificate(serviceId, r)); }} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
              Volver a emitir
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{hasStep ? "Todavía no se emitió." : "El camino de este servicio no tiene un paso Certificado."}</p>
      )}
      {previous.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {previous.map((p) => (
            <li key={p.id} className="flex gap-2">
              <span className="font-mono">{p.code}</span>
              <span>{CERTIFICATE_STATUS_LABEL[p.status] ?? p.status}</span>
              <span>{formatDate[p.id]}</span>
              {p.link && p.status === "void" && <a href={p.link} target="_blank" rel="noopener noreferrer" className="hover:underline">Ver</a>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
