import { statusLabel } from "@/lib/dashboards/ads";

/** El estado de un objeto de Meta: un punto y su nombre en palabras (Activa, Pausada...). */
export function StatusDot({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const active = status === "ACTIVE";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-green-500" : "bg-muted-foreground"}`} aria-hidden />
      <span className={active ? "text-green-600" : "text-muted-foreground"}>{active ? "Activa" : status === "PAUSED" ? "Pausada" : statusLabel(status)}</span>
    </span>
  );
}
