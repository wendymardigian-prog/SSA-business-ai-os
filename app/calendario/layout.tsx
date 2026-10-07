/**
 * Las paginas publicas de agenda (F25, F27, F28).
 *
 * Sin menu lateral y sin sesion: esto lo abre gente de afuera. El tema lo
 * fuerza el envoltorio con `data-theme` (ver app/globals.css); acá solo se
 * arma el marco.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  // `absolute` corta el template `%s | <marca>` del layout raiz: quien agenda
  // ve al negocio, no al software que usa por detras.
  title: { absolute: "Agendar" },
  // Una página de agenda no tiene por qué aparecer en Google.
  robots: { index: false, follow: false },
};

export default function CalendarioLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background text-foreground">{children}</div>;
}
