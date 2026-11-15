"use client";
// @plantilla-quitar(servicios)

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProgramSettings } from "@/lib/actions/services";
import { backfillPoints } from "@/lib/actions/points";
import { DEFAULT_CAPS, DEFAULT_LEVELS, POINT_EVENTS, POINT_GROUPS, pointsSettingsProblems, type PointEvent, type PointsSettings } from "@/lib/portal-points/rules";

export interface RankingRow {
  contact_id: string;
  name: string;
  total: number;
  level: { level: number; name: string };
  service_id: string | null;
}

/**
 * Portal › programa › Puntos (F129). Nacen APAGADOS (condición de Wendy, 14/11): con el interruptor apagado no se suma
 * nada. Valores por acción (vacío = el de siempre), topes por día de publicar y comentar (en la zona del estudiante),
 * los 9 niveles, si el ranking se ve en el portal y «Calcular lo ya hecho» (una vez, con confirmación; repetirlo no
 * duplica). Edita quien tiene `portal.points`; la base lo vuelve a pedir (00381).
 */
export function ProgramPointsPanel({
  productId,
  settings: initial,
  rev: initialRev,
  canEdit,
  ranking,
}: {
  productId: string;
  settings: PointsSettings;
  rev: number;
  canEdit: boolean;
  ranking: { students: number; rows: RankingRow[] } | null;
}) {
  const router = useRouter();
  const [rev, setRev] = useState(initialRev);
  const [enabled, setEnabled] = useState(initial.enabled === true);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial.values ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const capText = (k: "post" | "comment") => {
    const c = initial.caps;
    if (c && Object.prototype.hasOwnProperty.call(c, k)) return c[k] === null ? "" : String(c[k]);
    return String(DEFAULT_CAPS[k]);
  };
  const [caps, setCaps] = useState({ post: capText("post"), comment: capText("comment") });
  const [levels, setLevels] = useState(() => (initial.levels && initial.levels.length === 9 ? initial.levels : DEFAULT_LEVELS).map((l) => ({ name: l.name, min: String(l.min) })));
  const [rankingVisible, setRankingVisible] = useState(initial.ranking?.visible !== false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  function build(nextEnabled = enabled): PointsSettings {
    const vals: Partial<Record<PointEvent, number>> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim() !== "") vals[k as PointEvent] = Number(v);
    const toCap = (v: string) => (v.trim() === "" ? null : Number(v));
    const isDefaultLevels = levels.every((l, i) => l.name === DEFAULT_LEVELS[i].name && Number(l.min) === DEFAULT_LEVELS[i].min);
    return {
      enabled: nextEnabled,
      ...(Object.keys(vals).length ? { values: vals } : {}),
      caps: { post: toCap(caps.post), comment: toCap(caps.comment) },
      ...(isDefaultLevels ? {} : { levels: levels.map((l) => ({ name: l.name.trim(), min: Number(l.min) })) }),
      ranking: { visible: rankingVisible },
    };
  }

  function save(nextEnabled = enabled) {
    setMsg(null);
    const points = build(nextEnabled);
    const problems = pointsSettingsProblems(points);
    if (problems.length) return setMsg({ kind: "error", text: problems.join(". ") });
    start(async () => {
      const res = await saveProgramSettings(productId, { points }, rev);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      const d = res.data as { status: string; rev?: number; problems?: string[] };
      if (d.status === "ok") {
        setRev(d.rev ?? rev + 1);
        setEnabled(nextEnabled);
        setMsg({ kind: "ok", text: "Guardado." });
        router.refresh();
      } else if (d.status === "conflict") setMsg({ kind: "error", text: "Alguien cambió el programa mientras lo editabas. Recargá la página." });
      else setMsg({ kind: "error", text: (d.problems ?? []).join(". ") });
    });
  }

  function backfill() {
    setMsg(null);
    start(async () => {
      const res = await backfillPoints(productId);
      setConfirming(false);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      const added = res.data?.added ?? 0;
      setMsg({ kind: "ok", text: added > 0 ? `Listo: se sumaron ${added} ${added === 1 ? "registro" : "registros"} de lo ya hecho.` : "Ya estaba todo calculado: no se sumó nada." });
      router.refresh();
    });
  }

  const disabled = !canEdit || pending;
  const input = "w-20 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums disabled:opacity-60";

  return (
    <div className="max-w-3xl space-y-6">
      <section aria-labelledby="pts-on" className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 id="pts-on" className="text-sm font-semibold">
          Puntos del programa
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} disabled={disabled} onChange={(e) => save(e.target.checked)} />
          Prendidos
        </label>
        <p className="text-xs text-muted-foreground">
          {enabled
            ? "Los estudiantes suman puntos por lo que hacen desde ahora. Lo que hicieron antes se suma con «Calcular lo ya hecho»."
            : "Apagados: no se suma nada. Lo que ya se sumó queda guardado."}
        </p>
      </section>

      <section aria-labelledby="pts-values" className="space-y-3">
        <h2 id="pts-values" className="text-sm font-semibold">
          Cuánto vale cada cosa
        </h2>
        <p className="text-xs text-muted-foreground">Vacío = el valor de siempre. Un paso, una fase o una actividad con su propio valor gana a este.</p>
        {POINT_GROUPS.filter((g) => Object.values(POINT_EVENTS).some((e) => e.group === g.key)).map((g) => (
          <fieldset key={g.key} className="rounded-xl border border-border bg-card">
            <legend className="px-4 pt-3 text-xs font-medium text-muted-foreground">{g.label}</legend>
            <ul className="divide-y divide-border">
              {(Object.entries(POINT_EVENTS) as Array<[PointEvent, (typeof POINT_EVENTS)[PointEvent]]>)
                .filter(([, e]) => e.group === g.key)
                .map(([k, e]) => (
                  <li key={k} className="flex items-center justify-between gap-3 px-4 py-2">
                    <label htmlFor={`pts-${k}`} className="text-sm text-foreground">
                      {e.label}
                    </label>
                    <input
                      id={`pts-${k}`}
                      inputMode="numeric"
                      className={input}
                      placeholder={String(e.points)}
                      value={values[k] ?? ""}
                      disabled={disabled}
                      onChange={(ev) => setValues((v) => ({ ...v, [k]: ev.target.value.replace(/[^\d]/g, "") }))}
                    />
                  </li>
                ))}
            </ul>
          </fieldset>
        ))}
      </section>

      <section aria-labelledby="pts-caps" className="space-y-2">
        <h2 id="pts-caps" className="text-sm font-semibold">
          Topes por día
        </h2>
        <p className="text-xs text-muted-foreground">Cuántas veces por día suman, en la zona horaria del estudiante. Vacío = sin tope.</p>
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {(["post", "comment"] as const).map((k) => (
            <li key={k} className="flex items-center justify-between gap-3 px-4 py-2">
              <label htmlFor={`cap-${k}`} className="text-sm">
                {k === "post" ? "Publicaciones que suman por día" : "Comentarios que suman por día"}
              </label>
              <input id={`cap-${k}`} inputMode="numeric" className={input} placeholder="Sin tope" value={caps[k]} disabled={disabled} onChange={(e) => setCaps((c) => ({ ...c, [k]: e.target.value.replace(/[^\d]/g, "") }))} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pts-levels" className="space-y-2">
        <h2 id="pts-levels" className="text-sm font-semibold">
          Niveles
        </h2>
        <p className="text-xs text-muted-foreground">Con los puntos de siempre del programa. El primero empieza en 0 y cada uno pide más que el anterior.</p>
        <ol className="divide-y divide-border rounded-xl border border-border bg-card">
          {levels.map((l, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2">
              <span className="w-6 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <input
                aria-label={`Nombre del nivel ${i + 1}`}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
                maxLength={40}
                value={l.name}
                disabled={disabled}
                onChange={(e) => setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                desde
                <input
                  aria-label={`Puntos para el nivel ${i + 1}`}
                  inputMode="numeric"
                  className={input}
                  value={l.min}
                  disabled={disabled || i === 0}
                  onChange={(e) => setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, min: e.target.value.replace(/[^\d]/g, "") } : x)))}
                />
              </label>
            </li>
          ))}
        </ol>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rankingVisible} disabled={disabled} onChange={(e) => setRankingVisible(e.target.checked)} />
          Mostrar el ranking a los estudiantes en el portal
        </label>
      </section>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60" disabled={pending} onClick={() => save()}>
            Guardar
          </button>
          {enabled &&
            (confirming ? (
              <span className="flex flex-wrap items-center gap-2 text-sm">
                Se suman los puntos de lo que cada estudiante ya hizo (clases, pasos, entregas, comunidad, referidos). ¿Seguimos?
                <button type="button" className="rounded-md border border-border px-2 py-1 text-sm" disabled={pending} onClick={backfill}>
                  Sí, calcular
                </button>
                <button type="button" className="rounded-md px-2 py-1 text-sm text-muted-foreground" disabled={pending} onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
              </span>
            ) : (
              <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-60" disabled={pending} onClick={() => setConfirming(true)}>
                Calcular lo ya hecho
              </button>
            ))}
        </div>
      )}
      {msg && (
        <p role="status" className={msg.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {msg.text}
        </p>
      )}

      <section aria-labelledby="pts-ranking" className="space-y-2">
        <h2 id="pts-ranking" className="text-sm font-semibold">
          Ranking {ranking && ranking.students > 0 ? <span className="font-normal text-muted-foreground">· {ranking.students} con puntos</span> : null}
        </h2>
        {!ranking || ranking.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía nadie tiene puntos en este programa.</p>
        ) : (
          <ol className="divide-y divide-border rounded-xl border border-border bg-card">
            {ranking.rows.map((r, i) => (
              <li key={r.contact_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-6 tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  {r.service_id ? (
                    <Link href={`/dashboard/clientes?servicio=${r.service_id}`} className="hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  Nivel {r.level.level} · {r.level.name}
                </span>
                <span className="w-16 text-right font-medium tabular-nums">{r.total}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
