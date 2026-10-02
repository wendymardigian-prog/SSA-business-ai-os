import type { ReactNode } from "react";

/**
 * Estado vacío compartido de Configuración (S5): "el sistema debe funcionar
 * con base de datos vacía" (CLAUDE.md), y hasta este bloque varias pestañas
 * o no tenían nada que mostrar con cero filas, o mostraban un texto suelto
 * sin acción. Un solo componente con el mismo título en las seis pestañas.
 */
export function SettingsEmptyState({
  description,
  action,
}: {
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <p className="text-sm font-medium text-foreground">Todavía no hay nada acá</p>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
