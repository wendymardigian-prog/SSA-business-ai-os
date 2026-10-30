"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Moon, Sun, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { changeMyPassword, removeMyAvatar, updateMyContact, updateMyName, uploadMyAvatar } from "@/lib/actions/account";
import { setViewerTimezone } from "@/lib/actions/user-preferences";
import { parseContactInput, parseDisplayName, parsePasswordChange, PASSWORD_MIN } from "@/lib/account/validation";
import { listTimeZones } from "@/lib/timezone";
import { initialsOf } from "@/lib/shared/people";
import { useHtmlClass } from "@/components/use-html-class";
import { AccountCard, SaveStatus, inputClass, primaryButtonClass, secondaryButtonClass } from "./account-card";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";

export interface ProfileTabProps {
  email: string;
  name: string;
  avatarUrl: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  whatsappSameAsPhone: boolean;
  timezone: string;
  /** El boton de prueba de WhatsApp, si el negocio ya eligio desde donde se mandan los avisos. */
  whatsappTest?: React.ReactNode;
}

/** Mi cuenta → Perfil: una columna de tarjetas, cada una con su propio guardado. */
export function ProfileTab(props: ProfileTabProps) {
  return (
    <div className="space-y-4">
      <PhotoAndNameCard email={props.email} name={props.name} avatarUrl={props.avatarUrl} />
      <ContactCard
        phone={props.phone}
        whatsappPhone={props.whatsappPhone}
        whatsappSameAsPhone={props.whatsappSameAsPhone}
        whatsappTest={props.whatsappTest}
      />
      <PreferencesCard timezone={props.timezone} />
      <SecurityCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Foto y nombre
// ---------------------------------------------------------------------------

const AVATAR_SIDE = 384;

/**
 * Recorta la imagen a un cuadrado del centro y la achica a 384 px, en el
 * navegador: asi la foto pesa poco (entra en el limite de una Server Action) y
 * se ve igual en todos lados. El servidor la vuelve a validar por sus bytes.
 */
async function squareJpegDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIDE;
  canvas.height = AVATAR_SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, AVATAR_SIDE, AVATAR_SIDE);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.88);
}

function PhotoAndNameCard({ email, name: initialName, avatarUrl: initialUrl }: { email: string; name: string; avatarUrl: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState(initialUrl);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [savingName, startName] = useTransition();

  const shownName = name.trim() || savedName || email;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setPhotoError("La foto tiene que ser una imagen JPG, PNG o WEBP.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setPhotoError("La imagen pesa más de 15 MB: probá con otra.");
      return;
    }
    setPhotoBusy(true);
    try {
      const dataUrl = await squareJpegDataUrl(file);
      const result = await uploadMyAvatar({ dataUrl });
      if (!result.ok) setPhotoError(result.error);
      else {
        setAvatarUrl(result.url);
        router.refresh();
      }
    } catch {
      setPhotoError("No pude leer esa imagen. Probá con otra.");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onRemove() {
    setPhotoError(null);
    setPhotoBusy(true);
    const result = await removeMyAvatar();
    setPhotoBusy(false);
    if (!result.ok) setPhotoError(result.error);
    else {
      setAvatarUrl(null);
      router.refresh();
    }
  }

  function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNameSaved(false);
    const parsed = parseDisplayName(name);
    if (!parsed.ok) {
      setNameError(parsed.error);
      return;
    }
    setNameError(null);
    startName(async () => {
      const result = await updateMyName({ name: parsed.value });
      if (!result.ok) {
        setNameError(result.error);
        return;
      }
      setName(parsed.value);
      setSavedName(parsed.value);
      setNameSaved(true);
      router.refresh();
    });
  }

  const nameChanged = name.replace(/\s+/g, " ").trim() !== savedName;

  return (
    <AccountCard id="perfil" title="Tu perfil" description="Así te ve el resto del equipo en el chat, las tareas y la agenda.">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex items-center gap-3 sm:flex-col sm:items-center">
          <UserAvatar src={avatarUrl} initials={initialsOf(shownName)} size={80} className="text-2xl" />
          <div className="flex flex-wrap gap-2 sm:justify-center">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              id="account-avatar-file"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <button type="button" className={secondaryButtonClass} disabled={photoBusy} onClick={() => fileRef.current?.click()}>
              <Camera className="h-4 w-4" aria-hidden="true" />
              {photoBusy ? "Subiendo…" : avatarUrl ? "Cambiar foto" : "Subir foto"}
            </button>
            {avatarUrl && (
              <button type="button" className={secondaryButtonClass} disabled={photoBusy} onClick={onRemove} aria-label="Quitar la foto">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span className="sm:sr-only">Quitar</span>
              </button>
            )}
          </div>
        </div>

        <form onSubmit={onSaveName} className="min-w-0 flex-1 space-y-3">
          <div>
            <label htmlFor="account-name" className="mb-1 block text-xs font-medium">
              Nombre
            </label>
            <input
              id="account-name"
              value={name}
              maxLength={80}
              autoComplete="name"
              onChange={(e) => {
                setName(e.target.value);
                setNameSaved(false);
              }}
              aria-invalid={Boolean(nameError)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="account-email" className="mb-1 block text-xs font-medium">
              Email
            </label>
            <input id="account-email" value={email} readOnly disabled className={cn(inputClass, "cursor-not-allowed")} />
            <p className="mt-1 text-xs text-muted-foreground">Con este email entrás al sistema. Para cambiarlo, pedíselo a un Admin.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={primaryButtonClass} disabled={savingName || !nameChanged}>
              {savingName ? "Guardando…" : "Guardar nombre"}
            </button>
            <SaveStatus error={nameError} saved={nameSaved} />
          </div>
          {photoError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {photoError}
            </p>
          )}
        </form>
      </div>
    </AccountCard>
  );
}

// ---------------------------------------------------------------------------
// Telefono y WhatsApp
// ---------------------------------------------------------------------------

function ContactCard({
  phone: initialPhone,
  whatsappPhone: initialWhatsapp,
  whatsappSameAsPhone: initialSame,
  whatsappTest,
}: {
  phone: string | null;
  whatsappPhone: string | null;
  whatsappSameAsPhone: boolean;
  whatsappTest?: React.ReactNode;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [whatsapp, setWhatsapp] = useState(initialWhatsapp ?? "");
  const [same, setSame] = useState(initialSame);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const parsed = parseContactInput({ phone, whatsappPhone: whatsapp, sameAsPhone: same });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await updateMyContact({ phone, whatsappPhone: whatsapp, sameAsPhone: same });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPhone(result.phone ?? "");
      setWhatsapp(result.whatsappPhone ?? "");
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <AccountCard id="contacto" title="Teléfono y WhatsApp" description="Lo usamos solo para mandarte los avisos que vos elijas en Notificaciones.">
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="account-phone" className="mb-1 block text-xs font-medium">
            Teléfono
          </label>
          <input
            id="account-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+54 9 11 2233 4455"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setSaved(false);
            }}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted-foreground">Con el código de país adelante.</p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={same}
            onChange={(e) => {
              setSame(e.target.checked);
              setSaved(false);
            }}
            className="h-4 w-4 rounded border-border"
          />
          Mi WhatsApp es este mismo número
        </label>

        {!same && (
          <div>
            <label htmlFor="account-whatsapp" className="mb-1 block text-xs font-medium">
              WhatsApp
            </label>
            <input
              id="account-whatsapp"
              type="tel"
              inputMode="tel"
              placeholder="+54 9 11 2233 4455"
              value={whatsapp}
              onChange={(e) => {
                setWhatsapp(e.target.value);
                setSaved(false);
              }}
              className={inputClass}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryButtonClass} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
          {whatsappTest}
          <SaveStatus error={error} saved={saved} />
        </div>
      </form>
    </AccountCard>
  );
}

// ---------------------------------------------------------------------------
// Zona horaria y tema
// ---------------------------------------------------------------------------

function PreferencesCard({ timezone }: { timezone: string }) {
  const router = useRouter();
  const dark = useHtmlClass("dark");
  const zones = listTimeZones();
  const [tz, setTz] = useState(timezone);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function changeTimezone(next: string) {
    setTz(next);
    setSaved(false);
    setError(null);
    start(async () => {
      const result = await setViewerTimezone(next);
      if (!result.ok) {
        setError("No pude guardar la zona horaria. Probá de nuevo.");
        setTz(timezone);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function setTheme(nextDark: boolean) {
    document.documentElement.classList.toggle("dark", nextDark);
    try {
      localStorage.setItem("theme", nextDark ? "dark" : "light");
    } catch {
      // Sin localStorage (navegacion privada) el tema vale para esta pestaña.
    }
  }

  return (
    <AccountCard id="preferencias" title="Preferencias">
      <div className="space-y-4">
        <div>
          <label htmlFor="account-timezone" className="mb-1 block text-xs font-medium">
            Zona horaria
          </label>
          <select id="account-timezone" value={tz} disabled={pending} onChange={(e) => changeTimezone(e.target.value)} className={inputClass}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">Las fechas y horas de todo el sistema se te muestran en esta zona.</p>
          <div className="mt-1">
            <SaveStatus error={error} saved={saved} />
          </div>
        </div>

        <fieldset>
          <legend className="mb-1 block text-xs font-medium">Tema</legend>
          <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Tema">
            {[
              { value: false, label: "Claro", Icon: Sun },
              { value: true, label: "Oscuro", Icon: Moon },
            ].map(({ value, label, Icon }) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={dark === value}
                onClick={() => setTheme(value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
                  dark === value ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </AccountCard>
  );
}

// ---------------------------------------------------------------------------
// Contraseña y sesiones
// ---------------------------------------------------------------------------

function SecurityCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();

  const [othersState, setOthersState] = useState<"idle" | "busy" | "done" | "error">("idle");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const parsed = parsePasswordChange({ current, next, confirm });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await changeMyPassword({ current, next, confirm });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setSaved(true);
    });
  }

  async function signOutOthers() {
    setOthersState("busy");
    const { error: signOutError } = await createClient().auth.signOut({ scope: "others" });
    setOthersState(signOutError ? "error" : "done");
  }

  return (
    <AccountCard id="seguridad" title="Contraseña y seguridad">
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="account-current-password" className="mb-1 block text-xs font-medium">
            Contraseña actual
          </label>
          <input
            id="account-current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="account-new-password" className="mb-1 block text-xs font-medium">
              Contraseña nueva
            </label>
            <input
              id="account-new-password"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="account-confirm-password" className="mb-1 block text-xs font-medium">
              Repetí la contraseña nueva
            </label>
            <input
              id="account-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Al menos {PASSWORD_MIN} caracteres.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryButtonClass} disabled={saving || !current || !next}>
            {saving ? "Cambiando…" : "Cambiar contraseña"}
          </button>
          <SaveStatus error={error} saved={saved} savedText="Listo, ya podés entrar con la contraseña nueva" />
        </div>
      </form>

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-sm font-medium">Sesiones abiertas</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Si entraste desde una computadora que no es tuya, cerrá la sesión ahí. Esta sesión sigue abierta.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={secondaryButtonClass} disabled={othersState === "busy"} onClick={signOutOthers}>
            {othersState === "busy" ? "Cerrando…" : "Cerrar sesión en los otros dispositivos"}
          </button>
          {othersState === "done" && (
            <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">
              Listo ✓
            </p>
          )}
          {othersState === "error" && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              No pude cerrar las otras sesiones. Probá de nuevo.
            </p>
          )}
        </div>
      </div>
    </AccountCard>
  );
}
