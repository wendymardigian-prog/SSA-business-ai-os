"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Palette, Upload, Trash2, Check } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { resolveBrand, brandName as installationBrandName, brandColorHex as installationColor } from "@/lib/brand";
import { removeWorkspaceLogo, updateWorkspaceBrand, uploadWorkspaceLogo } from "@/lib/actions/workspace";
import { BRAND_NAME_MAX, EMAIL_FOOTER_ADDRESS_MAX, LANGUAGE_STYLE_MAX, MAX_LOGO_BYTES } from "@/lib/brand-settings";

export interface BrandSettingsInitial {
  name: string | null;
  logoPath: string | null;
  color: string | null;
  languageStyle: string | null;
  /** La dirección postal del pie de los emails de marketing (00270). */
  footerAddress?: string | null;
  /** El tono de la instalación (`AI_LANGUAGE_STYLE`), para mostrarlo como sugerencia. Lo pasa el servidor. */
  installationStyle: string;
}

/**
 * Marca del negocio (00266): lo que ven los leads de ESTE negocio en
 * formularios, contratos, agenda y emails, y el logo y el color del panel.
 * Cada campo vacío usa el de la instalación: un negocio que nunca toca esto
 * se ve igual que siempre.
 *
 * Nombre, color y tono se guardan con el botón; el logo se sube solo.
 */
export function BrandSettings({ initial }: { initial: BrandSettingsInitial }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name ?? "");
  const [color, setColor] = useState(initial.color ?? "");
  const [style, setStyle] = useState(initial.languageStyle ?? "");
  const [footerAddress, setFooterAddress] = useState(initial.footerAddress ?? "");
  const [logoPath, setLogoPath] = useState(initial.logoPath);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();
  const [uploading, startUpload] = useTransition();

  const preview = resolveBrand({ brand_name: name, brand_logo_path: logoPath, brand_color: color });
  const colorForPicker = /^#[0-9a-fA-F]{6}$/.test(color) ? color : (installationColor() ?? "#111827");

  function save() {
    setError(null);
    setSaved(false);
    startSave(async () => {
      const result = await updateWorkspaceBrand({ name, color, languageStyle: style, footerAddress });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    });
  }

  function pickLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_LOGO_BYTES) {
      setError("El logo pesa más de 500 KB: probá con uno más chico");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      startUpload(async () => {
        const result = await uploadWorkspaceLogo({ dataUrl });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setLogoPath(result.path);
        router.refresh();
      });
    };
    reader.onerror = () => setError("No pude leer la imagen");
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeLogo() {
    setError(null);
    startUpload(async () => {
      const result = await removeWorkspaceLogo();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLogoPath(null);
      router.refresh();
    });
  }

  const inputClass =
    "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <section>
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Marca</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Lo que ven los leads de este negocio en formularios, contratos, la agenda y los emails, y el logo y el color de este {/* @plantilla-quitar(formularios) */}
        {/* @plantilla-sin(formularios): Lo que ven los leads de este negocio en la agenda y los emails, y el logo y el color de este */}
        panel. Lo que dejes vacío usa la marca de la instalación ({installationBrandName()}).
      </p>

      <div className="mt-4 flex items-center gap-3 rounded-lg border border-border p-3">
        <BrandMark size={40} className="rounded-md" brand={preview} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{preview.name}</p>
          <p className="text-[11px] text-muted-foreground">Vista previa</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          id="brand-logo-input"
          onChange={(e) => pickLogo(e.target.files?.[0])}
        />
        <label
          htmlFor="brand-logo-input"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {logoPath ? "Cambiar logo" : "Subir logo"}
        </label>
        {logoPath && (
          <button
            type="button"
            onClick={removeLogo}
            disabled={uploading}
            aria-label="Sacar el logo"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">PNG, JPG o WEBP, hasta 500 KB. Se ve mejor cuadrado.</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="brand-name" className="text-xs font-medium text-muted-foreground">
            Nombre que ven los leads
          </label>
          <input
            id="brand-name"
            type="text"
            value={name}
            maxLength={BRAND_NAME_MAX}
            placeholder={installationBrandName()}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="brand-color" className="text-xs font-medium text-muted-foreground">
            Color principal
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="color"
              aria-label="Elegir el color"
              value={colorForPicker}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-10 cursor-pointer rounded border border-input bg-background"
            />
            <input
              id="brand-color"
              type="text"
              value={color}
              placeholder={installationColor() ?? "#111827"}
              onChange={(e) => setColor(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="brand-style" className="text-xs font-medium text-muted-foreground">
          Cómo escribe la IA de este negocio
        </label>
        <input
          id="brand-style"
          type="text"
          value={style}
          maxLength={LANGUAGE_STYLE_MAX}
          placeholder={initial.installationStyle}
          onChange={(e) => setStyle(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Por ejemplo «español rioplatense (vos/tenés)» o «español mexicano (tú)». Lo usan las respuestas, los resúmenes, el
          análisis de llamadas y el copywriter. {/* @plantilla-quitar(llamadas) */}
          {/* @plantilla-sin(llamadas): las tareas de IA y el copywriter. */}
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor="brand-footer-address" className="text-xs font-medium text-muted-foreground">
          Dirección postal para el pie de los emails (opcional)
        </label>
        <input
          id="brand-footer-address"
          type="text"
          value={footerAddress}
          maxLength={EMAIL_FOOTER_ADDRESS_MAX}
          placeholder="Av. Siempre Viva 742, Springfield"
          onChange={(e) => setFooterAddress(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Va abajo del link para darse de baja en los emails de marketing. Algunas leyes la piden a quien manda emails comerciales.
        </p>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Guardar marca
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <Check className="h-4 w-4" />
            Guardado
          </span>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </section>
  );
}
