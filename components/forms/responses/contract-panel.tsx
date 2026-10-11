"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Mail, RefreshCw } from "lucide-react";
import { Notice } from "@/components/agents/fields";
import { getContractPdfUrl, regenerateContractPdf, resendContractCopy } from "@/lib/actions/forms/contracts";
import { EMAIL_STATUS_LABELS, PDF_STATUS_LABELS, canRegenerate, canResend, canViewPdf, emailTone, pdfTone, type StatusTone } from "@/lib/forms/contract/status";
import { formatInZone } from "@/lib/forms/responses-query";
import { DEVICE_LABELS } from "@/lib/forms/contract/legal";
import type { ContractEmailStatus, ContractPdfStatus } from "@/lib/types/database";

export interface ContractView {
  signedAt: string;
  signerName: string;
  signerEmail: string;
  versionNumber: number | null;
  sha256: string;
  hasSignatureImage: boolean;
  pdfStatus: ContractPdfStatus;
  pdfAttempts: number;
  emailStatus: ContractEmailStatus;
  emailAttempts: number;
  emailNextRetryAt: string | null;
  emailSentAt: string | null;
  emailLastError: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  ip: string | null;
}

const TONE: Record<StatusTone, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  wait: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  bad: "bg-red-500/15 text-red-700 dark:text-red-300",
};

function Pill({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>{children}</span>;
}

/**
 * La firma de una respuesta de contrato (F26, F28): el PDF, la copia por email y los
 * datos de aceptación. Ver el PDF lo puede cualquiera que vea la respuesta; reenviar y
 * regenerar piden `forms.manage`.
 */
export function ContractPanel({ submissionId, contract, canManage, timeZone }: { submissionId: string; contract: ContractView; canManage: boolean; timeZone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function openPdf() {
    setMessage(null);
    start(async () => {
      const result = await getContractPdfUrl({ submissionId });
      if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
      else setMessage({ tone: "error", text: result.error });
    });
  }

  function resend() {
    setMessage(null);
    start(async () => {
      const result = await resendContractCopy({ submissionId });
      if (result.ok) {
        setMessage({ tone: "success", text: "Listo: la copia se está reenviando." });
        router.refresh();
      } else setMessage({ tone: "error", text: result.error });
    });
  }

  function regenerate() {
    setMessage(null);
    start(async () => {
      const result = await regenerateContractPdf({ submissionId });
      if (result.ok) {
        setMessage({ tone: "success", text: "Listo: el PDF se está generando de nuevo." });
        router.refresh();
      } else setMessage({ tone: "error", text: result.error });
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="firma-titulo">
      <h2 id="firma-titulo" className="text-sm font-semibold">
        Firma del contrato
      </h2>

      {message && (
        <div className="mt-3" role="status">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Firmante</dt>
          <dd>
            {contract.signerName || "—"} <span className="text-muted-foreground">· {contract.signerEmail}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Firmó</dt>
          <dd>{formatInZone(contract.signedAt, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Versión del texto</dt>
          <dd>
            {contract.versionNumber ? `Versión ${contract.versionNumber}` : "—"} <span className="font-mono text-xs text-muted-foreground">· {contract.sha256.slice(0, 16)}…</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Firma dibujada</dt>
          <dd>{contract.hasSignatureImage ? "Sí" : "No (no era obligatoria)"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Desde</dt>
          <dd>
            {[contract.device ? DEVICE_LABELS[contract.device as keyof typeof DEVICE_LABELS] ?? contract.device : null, contract.os, contract.browser].filter(Boolean).join(" · ") || "—"}
            {contract.ip ? <span className="ml-2 font-mono text-xs text-muted-foreground">{contract.ip}</span> : null}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">PDF firmado</p>
            <Pill tone={pdfTone(contract.pdfStatus)}>{PDF_STATUS_LABELS[contract.pdfStatus]}</Pill>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {canViewPdf(contract.pdfStatus) && (
              <button type="button" onClick={openPdf} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />} Ver PDF
              </button>
            )}
            {canManage && canRegenerate(contract.pdfStatus) && (
              <button type="button" onClick={regenerate} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Regenerar PDF
              </button>
            )}
          </div>
          {contract.pdfStatus === "failed" && <p className="mt-2 text-[11px] text-muted-foreground">La firma quedó guardada igual. Se reintentó {contract.pdfAttempts} {contract.pdfAttempts === 1 ? "vez" : "veces"}.</p>}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">Copia por email</p>
            <Pill tone={emailTone(contract.emailStatus)}>{EMAIL_STATUS_LABELS[contract.emailStatus]}</Pill>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {contract.emailStatus === "sent" && contract.emailSentAt ? `Enviada el ${formatInZone(contract.emailSentAt, timeZone)}` : null}
            {contract.emailStatus === "retrying" && contract.emailNextRetryAt ? `Próximo intento: ${formatInZone(contract.emailNextRetryAt, timeZone)}` : null}
            {contract.emailStatus === "not_sent" && contract.emailLastError ? contract.emailLastError : null}
          </p>
          {canManage && canResend(contract.pdfStatus) && (
            <button type="button" onClick={resend} disabled={pending} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
              <Mail className="h-3.5 w-3.5" aria-hidden /> Reenviar copia
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
