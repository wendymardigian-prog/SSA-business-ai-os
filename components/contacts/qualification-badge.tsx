import {
  QUALIFICATION_COLORS,
  isQualificationLevel,
  qualificationName,
  type QualificationSettings,
} from "@/lib/contacts/qualification";

/**
 * El nivel de calificación como insignia: cinco puntos (los primeros llenos con
 * el color del nivel) y el nombre. Sin nivel no dibuja nada, salvo que se pida
 * `showEmpty` (la lista y el Kanban muestran «Sin calificar» como guion).
 */
export function QualificationBadge({
  settings,
  level,
  compact = false,
}: {
  settings: QualificationSettings;
  level: number | null | undefined;
  /** Solo los puntos (la tarjeta del Kanban); el nombre queda en el `title`. */
  compact?: boolean;
}) {
  if (!isQualificationLevel(level)) return null;
  const name = qualificationName(settings, level);
  const color = QUALIFICATION_COLORS[level];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium"
      title={`Calificación: ${level} de 5 · ${name}`}
    >
      <QualificationDots level={level} color={color} />
      {!compact && <span className="truncate">{name}</span>}
      <span className="sr-only">{`Calificación ${level} de 5`}</span>
    </span>
  );
}

export function QualificationDots({ level, color }: { level: number; color: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className="h-1.5 w-1.5 rounded-full"
          style={n <= level ? { backgroundColor: color } : { backgroundColor: "var(--muted-foreground)", opacity: 0.25 }}
        />
      ))}
    </span>
  );
}
