/** El número de mensajes sin leer encima de un botón de icono (WhatsApp, email). El padre lleva `relative`. */
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white" aria-hidden>
      {count > 9 ? "9+" : count}
    </span>
  );
}

export const unreadText = (count: number) => (count === 1 ? "1 mensaje sin leer" : `${count} mensajes sin leer`);
