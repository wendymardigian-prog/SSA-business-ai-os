"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ContentDialog, DialogField } from "@/components/content/dialog";
import { categoryTree, type CategoryRow } from "@/lib/scheduling/categories";
import { defaultAssignmentForArea } from "@/lib/scheduling/assignment";
import { DURATION_PRESETS } from "@/lib/scheduling/event-validation";
import { isValidSlug, slugify } from "@/lib/scheduling/slug";
import { suggestSlug } from "@/lib/scheduling/event-validation";
import { createEventType } from "@/lib/actions/scheduling/event-types";

/**
 * Modal "+ Nuevo evento" (F17): pide lo minimo y crea el resto con lo que la
 * persona ya tiene configurado. El evento nace INACTIVO y se abre el editor.
 */
export function NewEventDialog({
  categories,
  publicBase,
  username,
  defaults,
  forUserId,
  onClose,
}: {
  categories: CategoryRow[];
  publicBase: string;
  username: string;
  defaults: { scheduleName: string | null; destinationCalendar: string | null; conflictCount: number; autoFlows: boolean };
  forUserId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const tree = categoryTree(categories);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [areaId, setAreaId] = useState(tree[0]?.area.id ?? "");
  const [typeId, setTypeId] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(30);
  const [customDuration, setCustomDuration] = useState(false);
  const [locationType, setLocationType] = useState<"google_meet" | "manual">("google_meet");
  const [locationText, setLocationText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const area = tree.find((t) => t.area.id === areaId);
  const effectiveSlug = slugTouched ? slug : suggestSlug(title);
  const slugOk = isValidSlug(effectiveSlug, 1, 60);
  const assignment = defaultAssignmentForArea(area?.area ?? null);

  function create() {
    setError(null);
    start(async () => {
      const result = await createEventType({
        title,
        slug: effectiveSlug,
        categoryId: typeId ?? areaId,
        durationMinutes: duration,
        locationType,
        locationText,
        forUserId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/dashboard/agenda/configuracion/eventos/${result.data.id}?creado=${result.data.flows}`);
    });
  }

  const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";
  const pill = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted"}`;

  return (
    <ContentDialog
      title="Nuevo evento"
      label="Nuevo evento"
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Queda inactivo hasta que lo actives</span>
          <span className="flex-1" />
          <button type="button" data-close onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm">Cancelar</button>
          <button type="button" onClick={create} disabled={pending || title.trim().length === 0 || !slugOk || !areaId} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Crear y configurar
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <DialogField label="Título">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={inputClass} placeholder="Llamada de descubrimiento" />
        </DialogField>

        <div>
          <p className="text-xs font-medium">Link</p>
          <div className="mt-1 flex items-center rounded-lg border border-input bg-background">
            <span className="hidden truncate pl-3 text-xs text-muted-foreground sm:inline">{publicBase}{username}/</span>
            <input
              value={effectiveSlug}
              onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value, true)); }}
              className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm focus:outline-none"
              spellCheck={false}
            />
          </div>
          {effectiveSlug.length > 0 && (
            <p className={`mt-1 text-xs ${slugOk ? "text-emerald-600" : "text-red-600"}`}>
              {slugOk ? "✓ Se ve bien" : "Solo minúsculas, números y guiones"}
            </p>
          )}
        </div>

        <div>
          <p className="text-xs font-medium">Área</p>
          <div role="radiogroup" aria-label="Área" className="mt-1 flex flex-wrap gap-2">
            {tree.map(({ area: a }) => (
              <button key={a.id} type="button" role="radio" aria-checked={areaId === a.id} onClick={() => { setAreaId(a.id); setTypeId(null); }} className={pill(areaId === a.id)}>
                {a.name}
              </button>
            ))}
          </div>
        </div>

        {area && area.types.length > 0 && (
          <div>
            <p className="text-xs font-medium">Tipo <span className="font-normal text-muted-foreground">(opcional)</span></p>
            <div role="radiogroup" aria-label="Tipo" className="mt-1 flex flex-wrap gap-2">
              {area.types.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={typeId === t.id} onClick={() => setTypeId(typeId === t.id ? null : t.id)} className={pill(typeId === t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-medium">Duración</p>
          <div role="radiogroup" aria-label="Duración" className="mt-1 flex flex-wrap items-center gap-2">
            {DURATION_PRESETS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={!customDuration && duration === d} onClick={() => { setCustomDuration(false); setDuration(d); }} className={pill(!customDuration && duration === d)}>
                {d} min
              </button>
            ))}
            <button type="button" role="radio" aria-checked={customDuration} onClick={() => setCustomDuration(true)} className={pill(customDuration)}>Otra</button>
            {customDuration && (
              <input type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Duración en minutos" className="h-8 w-20 rounded-lg border border-input bg-background px-2 text-sm" />
            )}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium">Ubicación</p>
          <div role="radiogroup" aria-label="Ubicación" className="mt-1 space-y-2">
            {([
              ["google_meet", "Google Meet", "El link se crea solo con cada agenda"],
              ["manual", "Ubicación manual", "Una dirección o una instrucción (\"te mando el link por WhatsApp\")"],
            ] as const).map(([key, label, sub]) => (
              <button key={key} type="button" role="radio" aria-checked={locationType === key} onClick={() => setLocationType(key)} className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left ${locationType === key ? "border-primary bg-primary/10" : "border-border"}`}>
                <span className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${locationType === key ? "border-primary bg-primary" : "border-muted-foreground"}`} />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{sub}</span>
                </span>
              </button>
            ))}
          </div>
          {locationType === "manual" && (
            <input value={locationText} onChange={(e) => setLocationText(e.target.value)} maxLength={500} className={`${inputClass} mt-2`} placeholder="Av. Siempre Viva 123, piso 3" />
          )}
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold">Se crea con lo que ya tenés configurado</p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            <li>✓ Horario: {defaults.scheduleName ?? "tu horario por defecto"}</li>
            <li>✓ Se agenda en: {defaults.destinationCalendar ?? "el calendario de tu perfil"} · revisa conflictos en {defaults.conflictCount} {defaults.conflictCount === 1 ? "calendario" : "calendarios"}</li>
            <li>✓ Formulario: nombre, email y teléfono</li>
            <li>✓ Contacto: {assignment === "vendedor_if_empty" ? "queda con el anfitrión como vendedor, si no tiene" : "no se cambia la asignación"}</li>
            {defaults.autoFlows && <li>✓ 7 flujos sugeridos, apagados</li>}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">Todo se puede cambiar después en el editor.</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </ContentDialog>
  );
}
