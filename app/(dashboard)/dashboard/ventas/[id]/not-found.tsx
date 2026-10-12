import Link from "next/link";

export default function VentaNoEncontrada() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <p className="text-sm font-medium">No encontré esa venta</p>
        <p className="text-xs text-muted-foreground">Puede que no exista o que no tengas acceso a ella.</p>
        <Link href="/dashboard/ventas" className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-accent">Volver a Ventas</Link>
      </div>
    </div>
  );
}
