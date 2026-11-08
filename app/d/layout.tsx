/**
 * El link público de un diseño (`/d/<código>`, F43). Sin menú y sin sesión: lo abre gente de afuera.
 * `noindex` por defecto; una página web publicada con "Permitir que aparezca en buscadores" lo cambia en
 * su propia página.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Diseño" },
  robots: { index: false, follow: false },
};

export default function DesignPublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background text-foreground">{children}</div>;
}
