"use client";

import { useId, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { saveStyle } from "@/lib/actions/designer/settings";
import { normalizeHexInput } from "@/lib/designer/color";
import { fontGroups, type UploadedFont } from "@/lib/designer/fonts";
import { DENSITY_FIELDS, MAX_RULES_CHARS, styleFromDraft, type StyleDraft } from "@/lib/designer/screens/settings";
import { SettingsDialog } from "./settings-dialog";

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const valid = normalizeHexInput(value);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-28 shrink-0 text-xs text-muted-foreground">
        {label}
      </label>
      <input type="color" aria-label={`${label}: elegir color`} value={valid ?? "#000000"} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 shrink-0 cursor-pointer rounded border border-input bg-background p-0.5" />
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-invalid={!valid} className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs aria-[invalid=true]:border-destructive" />
    </div>
  );
}

/** Crear o editar un estilo propio: nombre, colores, fuentes, densidad y reglas, con una vista previa. */
export function StyleEditor({ initial, corrections = [], google, uploaded, onClose, onSaved }: { initial: StyleDraft; corrections?: string[]; google: string[]; uploaded: UploadedFont[]; onClose: () => void; onSaved: (name: string) => void }) {
  const [draft, setDraft] = useState<StyleDraft>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const rulesId = useId();
  const groups = useMemo(() => fontGroups({ google, uploaded }), [google, uploaded]);
  const editing = initial.key !== null;

  const set = <K extends keyof StyleDraft>(key: K, value: StyleDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const preview = { bg: normalizeHexInput(draft.palette.bg) ?? "#ffffff", text: normalizeHexInput(draft.palette.text) ?? "#111111", accent: normalizeHexInput(draft.palette.accent) ?? "#4f46e5" };

  async function save() {
    const result = styleFromDraft(draft);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    setProblems([]);
    setSaving(true);
    try {
      const saved = await saveStyle({ style: result.style });
      if (!saved.ok) {
        setProblems([saved.error]);
        return;
      }
      onSaved(result.style.name);
    } catch {
      setProblems(["No pude guardar el estilo. Probá de nuevo."]);
    } finally {
      setSaving(false);
    }
  }

  const select = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground">
        {!groups.some((g) => g.families.includes(value)) && <option value={value}>{value}</option>}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );

  return (
    <SettingsDialog
      title={editing ? "Editar estilo" : "Nuevo estilo propio"}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Guardar estilo
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {corrections.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md bg-warn/10 p-3 text-xs text-warn" role="status">
            {corrections.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}

        <label htmlFor={nameId} className="flex flex-col gap-1 text-xs text-muted-foreground">
          Nombre del estilo
          <input id={nameId} value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={60} placeholder="Ej.: Mi marca, serio y cálido" className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
        </label>

        <div className="flex flex-col gap-2">
          <ColorField label="Fondo" value={draft.palette.bg} onChange={(v) => set("palette", { ...draft.palette, bg: v })} />
          <ColorField label="Texto" value={draft.palette.text} onChange={(v) => set("palette", { ...draft.palette, text: v })} />
          <ColorField label="Acento" value={draft.palette.accent} onChange={(v) => set("palette", { ...draft.palette, accent: v })} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {select("Fuente de los títulos", draft.fonts.title, (v) => set("fonts", { ...draft.fonts, title: v }))}
          {select("Fuente del cuerpo", draft.fonts.body, (v) => set("fonts", { ...draft.fonts, body: v }))}
        </div>

        <div
          className="flex flex-col gap-1 rounded-lg border border-border p-4"
          style={{ background: preview.bg, color: preview.text }}
          role="img"
          aria-label="Vista previa del estilo"
        >
          <span className="text-2xl leading-tight" style={{ fontFamily: `"${draft.fonts.title}", sans-serif`, fontWeight: 700 }}>
            Un título que se lee de lejos
          </span>
          <span className="text-sm" style={{ fontFamily: `"${draft.fonts.body}", sans-serif` }}>
            El cuerpo del texto va con esta otra fuente.
          </span>
          <span className="mt-1 h-1.5 w-16 rounded-full" style={{ background: preview.accent }} />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-muted-foreground">Palabras por página (hasta)</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {DENSITY_FIELDS.map((field) => (
              <label key={field.key} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                {field.label}
                <input type="number" min={5} max={1000} value={draft.density[field.key]} onChange={(e) => set("density", { ...draft.density, [field.key]: e.target.value })} className="w-20 rounded-md border border-input bg-background px-2 py-1 text-right text-sm text-foreground" />
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor={rulesId} className="flex flex-col gap-1 text-xs text-muted-foreground">
          Reglas de composición para la IA
          <textarea id={rulesId} value={draft.rules} onChange={(e) => set("rules", e.target.value)} rows={5} placeholder="Ej.: títulos enormes en mayúsculas, un solo acento por página, mucho aire." className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
          <span className="self-end text-[11px]">
            {draft.rules.length} / {MAX_RULES_CHARS}
          </span>
        </label>

        {problems.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-destructive" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    </SettingsDialog>
  );
}
