"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { addGoogleFont, removeFont, uploadFont } from "@/lib/actions/designer/settings";
import { FONT_LICENSE_NOTICE } from "@/lib/designer/fonts";
import { actionErrorText } from "@/lib/designer/screens/ai-panel";
import { checkFontFile, FONT_SAMPLE, fontRows, WEIGHT_OPTIONS, weightLabel } from "@/lib/designer/screens/settings";
import type { UploadedFontEntry } from "@/lib/designer/settings-schema";

type Panel = null | "google" | "upload";

/** «Fuentes»: las de Google agregadas y las subidas, con su vista «Aa Bb Cc»; + Agregar de Google; + Subir. */
export function FontsSection({ google, uploaded, curatedCount }: { google: string[]; uploaded: UploadedFontEntry[]; curatedCount: number }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [family, setFamily] = useState("");
  const [uploadFamily, setUploadFamily] = useState("");
  const [weight, setWeight] = useState(400);
  const [italic, setItalic] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const googleId = useId();
  const uploadNameId = useId();
  const rows = fontRows({ google, uploaded });

  async function run(task: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await task();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus(result.message);
      setPanel(null);
      setFamily("");
      setUploadFamily("");
      setItalic(false);
      setWeight(400);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (e) {
      setError(actionErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const addGoogle = () =>
    run(async () => {
      const result = await addGoogleFont({ family });
      return result.ok ? { ok: true, message: `Agregué «${result.data.family}».` } : result;
    });

  const upload = () =>
    run(async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) return { ok: false, error: "Elegí un archivo de fuente." };
      const problem = checkFontFile(file);
      if (problem) return { ok: false, error: problem };
      const form = new FormData();
      form.append("file", file);
      if (uploadFamily.trim()) form.append("family", uploadFamily.trim());
      form.append("weight", String(weight));
      if (italic) form.append("italic", "true");
      const result = await uploadFont(form);
      return result.ok ? { ok: true, message: `Subí «${result.data.family}» (${weightLabel(result.data.weight)}).` } : result;
    });

  const remove = (row: ReturnType<typeof fontRows>[number]) =>
    run(async () => {
      const result = await removeFont({ family: row.family, path: row.path });
      setConfirmRemove(null);
      return result.ok ? { ok: true, message: `Quité «${row.family}».` } : result;
    });

  return (
    <section aria-labelledby="fuentes" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="fuentes" className="text-base font-semibold">
            Fuentes
          </h2>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{`Además de las ${curatedCount} de la lista, podés sumar cualquier fuente de Google o subir las tuyas. Las dos aparecen en el desplegable de tipografía del editor y la IA las puede usar.`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPanel(panel === "google" ? null : "google")} aria-expanded={panel === "google"} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
            + Agregar de Google
          </button>
          <button type="button" onClick={() => setPanel(panel === "upload" ? null : "upload")} aria-expanded={panel === "upload"} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
            + Subir
          </button>
        </div>
      </div>

      {panel === "google" && (
        <form
          className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void addGoogle();
          }}
        >
          <label htmlFor={googleId} className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Nombre como figura en Google Fonts
            <input id={googleId} value={family} onChange={(e) => setFamily(e.target.value)} placeholder="Ej.: Lobster" autoComplete="off" spellCheck={false} className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
          </label>
          <button type="submit" disabled={busy || !family.trim()} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? "Comprobando…" : "Comprobar y agregar"}
          </button>
        </form>
      )}

      {panel === "upload" && (
        <form
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void upload();
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Archivo (.woff2, .woff, .ttf u .otf, hasta 2 MB)
            <input ref={fileRef} type="file" accept=".woff2,.woff,.ttf,.otf" className="text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm" />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label htmlFor={uploadNameId} className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-1">
              Nombre de la fuente
              <input id={uploadNameId} value={uploadFamily} onChange={(e) => setUploadFamily(e.target.value)} placeholder="Si lo dejás vacío, el del archivo" className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Peso
              <select value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground">
                {WEIGHT_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {weightLabel(w)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pt-5 text-sm">
              <input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} /> Es cursiva
            </label>
          </div>
          <p className="text-xs text-muted-foreground">{FONT_LICENSE_NOTICE}</p>
          <button type="submit" disabled={busy} className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? "Subiendo…" : "Subir fuente"}
          </button>
        </form>
      )}

      {status && (
        <p className="text-xs text-good" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">Todavía no sumaste fuentes</p>
          <p className="mt-1 text-xs text-muted-foreground">{`Usá «+ Agregar de Google» o «+ Subir». Mientras tanto tenés las ${curatedCount} de la lista.`}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((row) => {
            const id = `${row.kind}:${row.path ?? row.family}`;
            return (
              <li key={id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="w-40 shrink-0 text-xl leading-none" style={{ fontFamily: `"${row.family}", sans-serif`, fontWeight: row.kind === "uploaded" ? Number(/(\d{3})/.exec(row.detail)?.[1] ?? 400) : 400 }}>
                  {FONT_SAMPLE}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block break-words text-sm font-medium">{row.family}</b>
                  <span className="block text-xs text-muted-foreground">{row.detail}</span>
                </span>
                {confirmRemove === id ? (
                  <span className="flex items-center gap-2 text-xs">
                    Los diseños que la usan pasan a una fuente de reemplazo.
                    <button type="button" onClick={() => void remove(row)} disabled={busy} className="rounded-md bg-destructive px-2.5 py-1 text-white hover:opacity-90 disabled:opacity-50">
                      Quitar
                    </button>
                    <button type="button" onClick={() => setConfirmRemove(null)} className="rounded-md border border-border px-2.5 py-1 hover:bg-accent">
                      Cancelar
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmRemove(id)} aria-label={`Quitar ${row.family}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
