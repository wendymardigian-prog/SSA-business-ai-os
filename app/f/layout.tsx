/**
 * Los formularios públicos (F9).
 *
 * Sin menú lateral y sin sesión: esto lo abre gente de afuera, y muchas veces
 * adentro de un iframe en la web de otra persona. El marco es mínimo; la marca
 * (logo y color) sale del white label.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  // `absolute` corta el template `%s | <marca>` del layout raíz.
  title: { absolute: "Formulario" },
  // Un formulario no tiene por qué aparecer en Google.
  robots: { index: false, follow: false },
};

export default function FormLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background text-foreground">{children}</div>;
}
