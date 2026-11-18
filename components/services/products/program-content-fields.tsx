// @plantilla-quitar(servicios)
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Lock } from "lucide-react";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { loadVariantInvitation, type VariantInvitationData } from "@/lib/actions/variant-invitation";
import type { NotIncluded, SectionRule } from "@/lib/portal-admin/settings";
import { destinationKey } from "@/lib/attribution/piece-link-destinations";
import { excludedModules, invitationHref, readNotIncluded, toggleModule, whatsappDigits, withMode, type NotIncludedMode } from "@/lib/program/upgrade-invitation";

const input = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary-edge focus:outline-none focus:ring-1 focus:ring-primary-edge";
const area = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary-edge focus:outline-none focus:ring-1 focus:ring-primary-edge";
const label = "mb-1.5 block text-xs font-semibold text-foreground";
const hint = "mt-1 text-[11px] text-muted-foreground";

const MODES: Array<{ value: NotIncludedMode; label: string }> = [
  { value: "hidden", label: "No se ven" },
  { value: "locked", label: "Se ven con candado" },
  { value: "invite", label: "Se ven con candado e invitación para pasarse" },
];

/**
 * La regla Programa de la variante: qué módulos incluye y qué pasa con los que no (00404). Va dentro del drawer de la
 * regla; los cambios se guardan con «Guardar el portal», como el resto.
 */
export function ProgramContentFields({
  variantId,
  programName,
  rule,
  members,
  onChange,
}: {
  variantId: string;
  programName: string;
  rule: SectionRule | undefined;
  members: Array<{ id: string; name: string }>;
  onChange: (patch: Partial<SectionRule>) => void;
}) {
  const [data, setData] = useState<VariantInvitationData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPeople, setShowPeople] = useState(false);
  const timeZone = useViewerTimezone();

  useEffect(() => {
    let alive = true;
    loadVariantInvitation(variantId).then((res) => {
      if (!alive) return;
      if (res.ok) setData(res.data);
      else setLoadError(res.error.message);
    });
    return () => {
      alive = false;
    };
  }, [variantId]);

  const content = rule?.content;
  const someModules = !!content && content.modules !== "all";
  const ni = readNotIncluded(rule);
  const setNi = (next: NotIncluded) => onChange({ not_included: next });

  if (loadError) return <p className="text-xs text-bad">{loadError}</p>;
  if (!data)
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Cargando los módulos…
      </p>
    );

  const regular = data.modules.filter((m) => !m.extra);
  const extras = data.modules.filter((m) => m.extra);
  const isOn = (id: string) => !content || content.modules === "all" || content.modules.includes(id);
  const excluded = excludedModules(data.modules, content);
  const target = ni.target;
  const href = invitationHref(target);
  const destKey = target && (target.kind === "form" || target.kind === "event") && target.id ? destinationKey({ kind: target.kind, id: target.id }) : "";
  const allDest = [...data.destinations.forms, ...data.destinations.events];

  const moduleRow = (m: (typeof data.modules)[number]) => (
    <label key={m.id} className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={isOn(m.id)} onChange={(e) => onChange(contentPatch(toggleModule(content, data.modules, m.id, e.target.checked)))} />
      <span className="truncate">
        {m.number !== null ? `${m.number} · ` : ""}
        {m.title}
      </span>
    </label>
  );

  // Volver a «todo el programa» apaga los no incluidos (no queda nada que mostrar).
  function contentPatch(next: NonNullable<SectionRule["content"]>): Partial<SectionRule> {
    if (next.modules === "all" && ni.mode !== "hidden") return { content: next, not_included: { ...ni, mode: "hidden" } };
    return { content: next };
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className={label}>Contenido</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={!someModules} onChange={() => onChange(contentPatch({ modules: "all" }))} /> Todo el programa
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={someModules} onChange={() => !someModules && data.modules.length > 0 && onChange({ content: { modules: data.modules.map((m) => m.id) } })} /> Solo
            estos módulos
          </label>
        </div>
        {someModules && (
          <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-border p-3">
            {regular.map(moduleRow)}
            {extras.length > 0 && <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Extras</p>}
            {extras.map(moduleRow)}
          </div>
        )}
        <p className={hint}>Con dos servicios del mismo programa, la persona ve los módulos de los dos.</p>
      </fieldset>

      {someModules && (
        <fieldset className="space-y-3 border-t border-border pt-4">
          <legend className={label}>Módulos que esta variante no incluye</legend>
          <div className="space-y-1.5">
            {MODES.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="not-included-mode" checked={ni.mode === o.value} onChange={() => setNi(withMode(ni, o.value, programName))} />
                {o.label}
              </label>
            ))}
          </div>
          {ni.mode !== "hidden" && (
            <p className={hint}>
              {excluded.length} {excluded.length === 1 ? "módulo aparece" : "módulos aparecen"} con candado después de los suyos. No se pueden abrir: al tocarlos se ve la
              descripción y la lista de clases. No cuentan en su avance.
            </p>
          )}

          {ni.mode !== "hidden" && (
            <div>
              <label htmlFor="ni-label" className={label}>
                Etiqueta de cada módulo
              </label>
              <input id="ni-label" maxLength={40} value={ni.label ?? ""} placeholder="No incluido en tu plan" onChange={(e) => setNi({ ...ni, label: e.target.value })} className={input} />
            </div>
          )}

          {ni.mode === "invite" && (
            <>
              <div>
                <label htmlFor="ni-text" className={label}>
                  Texto de la invitación
                </label>
                <textarea id="ni-text" rows={3} maxLength={400} value={ni.text ?? ""} onChange={(e) => setNi({ ...ni, text: e.target.value })} className={area} />
              </div>
              <div>
                <label htmlFor="ni-button" className={label}>
                  Botón
                </label>
                <input id="ni-button" maxLength={30} value={ni.button ?? ""} onChange={(e) => setNi({ ...ni, button: e.target.value })} className={input} />
              </div>
              <div>
                <label htmlFor="ni-target" className={label}>
                  A dónde lleva
                </label>
                <select
                  id="ni-target"
                  value={target?.kind ?? ""}
                  onChange={(e) => {
                    const kind = e.target.value as NonNullable<NotIncluded["target"]>["kind"] | "";
                    setNi({ ...ni, target: kind ? { kind } : undefined });
                  }}
                  className={input}
                >
                  <option value="">Elegí…</option>
                  <option value="link">Un link (por ejemplo, el de pago)</option>
                  {data.destinations.forms.length > 0 && <option value="form">Un formulario</option>}
                  {data.destinations.events.length > 0 && <option value="event">Una agenda</option>}
                  <option value="whatsapp">WhatsApp</option>
                </select>
                {target?.kind === "link" && (
                  <input aria-label="Link" placeholder="https://…" value={target.url ?? ""} onChange={(e) => setNi({ ...ni, target: { kind: "link", url: e.target.value.trim() } })} className={`${input} mt-2`} />
                )}
                {(target?.kind === "form" || target?.kind === "event") && (
                  <select
                    aria-label={target.kind === "form" ? "Formulario" : "Agenda"}
                    value={destKey}
                    onChange={(e) => {
                      const d = allDest.find((x) => destinationKey(x) === e.target.value);
                      setNi({ ...ni, target: d ? { kind: d.kind, id: d.id, url: d.url } : { kind: target.kind } });
                    }}
                    className={`${input} mt-2`}
                  >
                    <option value="">Elegí…</option>
                    {(target.kind === "form" ? data.destinations.forms : data.destinations.events).map((d) => (
                      <option key={destinationKey(d)} value={destinationKey(d)}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                )}
                {target?.kind === "whatsapp" && (
                  <div className="mt-2 space-y-2">
                    <input
                      aria-label="Número de WhatsApp"
                      placeholder="+506 8888 1234"
                      value={target.value ?? ""}
                      onChange={(e) => setNi({ ...ni, target: { ...target, value: e.target.value } })}
                      onBlur={(e) => setNi({ ...ni, target: { ...target, value: whatsappDigits(e.target.value) } })}
                      className={input}
                    />
                    <input
                      aria-label="Mensaje armado"
                      maxLength={500}
                      placeholder="Hola, quiero pasarme al programa completo"
                      value={target.prefill ?? ""}
                      onChange={(e) => setNi({ ...ni, target: { ...target, prefill: e.target.value } })}
                      className={input}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs font-semibold">Al tocar el botón (una vez cada 7 días por persona)</p>
                <div>
                  <label htmlFor="ni-tag" className={label}>
                    Ponerle la etiqueta
                  </label>
                  <select
                    id="ni-tag"
                    value={ni.on_click?.tag_id ?? ""}
                    onChange={(e) => setNi({ ...ni, on_click: { ...ni.on_click, tag_id: e.target.value || null } })}
                    className={input}
                  >
                    <option value="">Ninguna</option>
                    {data.tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <p className={hint}>Las etiquetas se crean en Contactos.</p>
                </div>
                <div>
                  <label htmlFor="ni-notify" className={label}>
                    Avisar en la campana a
                  </label>
                  <select
                    id="ni-notify"
                    value={ni.on_click?.notify ?? ""}
                    onChange={(e) => setNi({ ...ni, on_click: { ...ni.on_click, notify: e.target.value || null } })}
                    className={input}
                  >
                    <option value="">Nadie</option>
                    <option value="owner">El responsable del servicio</option>
                    <option value="admins">Los administradores</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className={hint}>También dispara «Tocó la invitación para pasarse» en Automatizaciones.</p>
              </div>

              <div>
                <p className={label}>Vista previa</p>
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" aria-hidden /> {ni.label?.trim() || "No incluido en tu plan"}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{excluded[0] ? `${excluded[0].number !== null ? `${excluded[0].number} · ` : ""}${excluded[0].title}` : "Un módulo"}</p>
                  <p className="mt-2 whitespace-pre-line text-sm">{ni.text}</p>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">
                      {ni.button || "Botón"}
                    </a>
                  ) : (
                    <span className="mt-3 inline-flex h-8 items-center rounded-lg bg-primary/40 px-3 text-xs font-medium text-primary-foreground">{ni.button || "Botón"}</span>
                  )}
                </div>
              </div>
            </>
          )}

          {data.stats && (data.stats.saw > 0 || data.stats.clicked > 0) && (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p>
                <strong>{data.stats.saw}</strong> vieron · <strong>{data.stats.clicked}</strong> tocaron · <strong>{data.stats.upgraded}</strong> se pasaron (30 días)
              </p>
              {data.stats.people.length > 0 && (
                <button type="button" onClick={() => setShowPeople((v) => !v)} className="mt-1 text-xs text-primary-ink hover:underline">
                  {showPeople ? "Ocultar" : "Ver quiénes tocaron"}
                </button>
              )}
              {showPeople && (
                <ul className="mt-2 space-y-1 text-xs">
                  {data.stats.people.map((p) => (
                    <li key={p.contact_id} className="flex items-center justify-between gap-2">
                      <Link href={`/dashboard/contacts/${p.contact_id}`} className="truncate hover:underline">
                        {p.name || "Sin nombre"}
                      </Link>
                      <span className="shrink-0 text-muted-foreground">
                        {new Date(p.last_at).toLocaleDateString("es", { timeZone })}
                        {p.upgraded_at ? " · se pasó" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}
