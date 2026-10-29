/**
 * La pagina publica de baja de los emails (suscripcion a emails, E3).
 *
 * Sin menu, sin sesion y fuera de los buscadores: la abre la persona que recibio un
 * email de marketing desde el link del pie.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  // `absolute` corta el template `%s | <marca>` del layout raiz.
  title: { absolute: "Darte de baja" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function UnsubscribeLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background text-foreground">{children}</div>;
}
