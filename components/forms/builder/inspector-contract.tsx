"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { Checkbox, Field, Notice, inputClass } from "@/components/agents/fields";
import { saveContractConfig, uploadBusinessSignature } from "@/lib/actions/forms/config";
import { SignatureCanvas } from "@/components/forms/public/signature-canvas";
import type { BusinessSigner, ContractMode } from "@/lib/forms/defaults";
import { MAX_CC_EMAILS, parseCcInput, validateContractConfig, type ContractConfig } from "@/lib/forms/contract/config";
import type { EmailReadiness } from "@/lib/email/readiness";

/**
 * El panel del contrato en Diseño (antes, la pestaña Contrato): el modo (Aceptación de términos o Contrato), el título,
 * la casilla de aceptación, si la firma es obligatoria, la firma de ambas partes y las copias por email. Se guarda con
 * su propio botón (no es parte del borrador: rige apenas se guarda).
 */
export function InspectorContract({
  formId,
  config,
  onSaved,
  canManage,
  disabled,
  hasSignerEmail,
  emailReadiness,
  signatureUrl,
}: {
  formId: string;
  config: ContractConfig;
  onSaved: (config: ContractConfig) => void;
  canManage: boolean;
  disabled: boolean;
  /** El contrato necesita un email obligatorio (ahí va la copia firmada). */
  hasSignerEmail: boolean;
  /** Si la copia por correo va a salir; sin dato, no se avisa nada. */
  emailReadiness?: EmailReadiness;
  /** Link temporal a la firma del negocio guardada (para mostrarla). */
  signatureUrl?: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(config.title);
  const [acceptLabel, setAcceptLabel] = useState(config.acceptLabel);
  const [signatureRequired, setSignatureRequired] = useState(config.signatureRequired);
  const [ccText, setCcText] = useState(config.ccEmails.join(", "));
  const [copyToOwner, setCopyToOwner] = useState(config.copyToOwner);
  const [mode, setMode] = useState<ContractMode>(config.mode);
  const [signer, setSigner] = useState<BusinessSigner>(config.businessSigner);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, start] = useTransition();

  const next = {
    ...config,
    title,
    acceptLabel,
    signatureRequired,
    ccEmails: parseCcInput(ccText),
    copyToOwner,
    mode,
    // La firma de ambas partes solo existe en modo Contrato.
    businessSigner: mode === "contract" ? signer : { ...signer, enabled: false },
  };
  const validation = validateContractConfig(next);

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveContractConfig({ formId, config: next });
      if (result.ok && validation.ok) {
        onSaved(validation.config);
        setMessage({ tone: "success", text: "Guardado" });
        router.refresh();
      } else if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
      }
    });
  }

  return (
    <div className="space-y-4">
      {!hasSignerEmail && <Notice tone="warning">El contrato necesita una pregunta de email obligatoria: ahí se manda la copia firmada.</Notice>}
      {emailReadiness && !emailReadiness.ok && <Notice tone="warning">{emailReadiness.message}</Notice>}

      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1 text-xs font-semibold">Modo</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="contract-mode" className="mt-1" disabled={disabled} checked={mode === "terms"} onChange={() => setMode("terms")} />
          <span>
            <span className="font-medium">Aceptación de términos</span>
            <span className="block text-xs text-muted-foreground">El texto arriba, igual para todos; la persona completa sus datos, acepta y firma.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="contract-mode" className="mt-1" disabled={disabled} checked={mode === "contract"} onChange={() => setMode("contract")} />
          <span>
            <span className="font-medium">Contrato</span>
            <span className="block text-xs text-muted-foreground">
              Primero la persona completa sus datos; después ve el contrato con esos datos ya puestos (variables) y firma. Puede llevar tu firma también.
            </span>
          </span>
        </label>
        {mode !== config.mode && <p className="text-xs text-muted-foreground">El cambio de modo se ve en el lienzo al guardar.</p>}
      </fieldset>

      {mode === "contract" && <BusinessSignerSection formId={formId} signer={signer} onChange={setSigner} disabled={disabled} initialUrl={signatureUrl ?? null} />}

      <Field label="Título del contrato" hint="Aparece arriba del texto y en el PDF.">
        {(id) => <input id={id} className={inputClass} disabled={disabled} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field label="Texto de la casilla de aceptación" hint="La casilla es siempre obligatoria.">
        {(id) => <input id={id} className={inputClass} disabled={disabled} value={acceptLabel} maxLength={200} onChange={(e) => setAcceptLabel(e.target.value)} />}
      </Field>
      <Checkbox
        checked={signatureRequired}
        onChange={setSignatureRequired}
        label="La firma dibujada es obligatoria"
        description="Sin esto, alcanza con aceptar la casilla (el PDF dice que no hubo firma dibujada)."
      />
      <Field label="Copias por email" hint={`Quien firma recibe su copia. Sumá hasta ${MAX_CC_EMAILS} direcciones más, separadas por coma.`}>
        {(id) => <input id={id} className={inputClass} disabled={disabled} value={ccText} onChange={(e) => setCcText(e.target.value)} placeholder="legal@tuempresa.com" />}
      </Field>
      <Checkbox
        checked={copyToOwner}
        onChange={setCopyToOwner}
        label="Mandarme una copia firmada"
        description="Cada vez que alguien firma, el Owner del negocio recibe el PDF por correo."
      />
      {!validation.ok && <p className="text-xs text-destructive">{validation.errors[0]}</p>}

      {message && (
        <div role="status">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      {canManage && (
        <button
          type="button"
          onClick={save}
          disabled={disabled || saving || !validation.ok}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Guardar los ajustes del contrato
        </button>
      )}
    </div>
  );
}

/** "Firma de ambas partes": tu firma (dibujada o subida), tu nombre y tu cargo, estampados en cada contrato. */
function BusinessSignerSection({
  formId,
  signer,
  onChange,
  disabled,
  initialUrl,
}: {
  formId: string;
  signer: BusinessSigner;
  onChange: (next: BusinessSigner) => void;
  disabled: boolean;
  initialUrl: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [drawing, setDrawing] = useState(false);
  const [drawn, setDrawn] = useState<{ dataUrl: string; strokes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function upload(dataUrl: string) {
    setError(null);
    startUpload(async () => {
      const result = await uploadBusinessSignature({ formId, dataUrl });
      if (!result.ok) return setError(result.error);
      onChange({ ...signer, signaturePath: result.path });
      setUrl(result.url);
      setDrawing(false);
      setDrawn(null);
    });
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 500 * 1024) return setError("La imagen pesa más de 500 KB: probá con una más chica");
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" && upload(reader.result);
    reader.onerror = () => setError("No pude leer la imagen. Probá con otra.");
    reader.readAsDataURL(file);
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-3">
      <Checkbox
        checked={signer.enabled}
        onChange={(enabled) => onChange({ ...signer, enabled })}
        label="Firma de ambas partes"
        description="Tu firma, tu nombre y tu cargo van abajo del contrato, al lado de la firma de la persona, en la pantalla y en el PDF."
      />
      {signer.enabled && (
        <div className="space-y-3">
          {url && !drawing ? (
            // eslint-disable-next-line @next/next/no-img-element -- link temporal a un bucket privado: next/image no aporta acá
            <img src={url} alt="Tu firma guardada" className="h-20 w-full rounded border border-border bg-white object-contain" />
          ) : !drawing ? (
            <p className="text-xs text-muted-foreground">Todavía no cargaste tu firma.</p>
          ) : null}

          {drawing ? (
            <div className="space-y-2">
              <SignatureCanvas onChange={(dataUrl, strokes) => setDrawn(dataUrl ? { dataUrl, strokes } : null)} disabled={disabled || uploading} />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!drawn || drawn.strokes < 1 || uploading}
                  onClick={() => drawn && upload(drawn.dataUrl)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Usar esta firma
                </button>
                <button type="button" onClick={() => setDrawing(false)} className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:bg-accent">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={disabled || uploading} onClick={() => setDrawing(true)} className="h-8 rounded-lg border border-border px-3 text-xs hover:bg-accent disabled:opacity-50">
                {url ? "Volver a dibujar" : "Dibujar mi firma"}
              </button>
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs hover:bg-accent disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />} Subir una imagen
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                aria-label="Subir la imagen de tu firma"
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <Field label="Nombre de quien firma por el negocio">
            {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={120} value={signer.name} onChange={(e) => onChange({ ...signer, name: e.target.value })} placeholder="Laura Méndez" />}
          </Field>
          <Field label="Cargo (opcional)">
            {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={120} value={signer.role} onChange={(e) => onChange({ ...signer, role: e.target.value })} placeholder="Directora" />}
          </Field>
        </div>
      )}
    </section>
  );
}
