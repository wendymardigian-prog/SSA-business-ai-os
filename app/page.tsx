import { redirect } from "next/navigation";

/**
 * Sin pagina publica de marketing: el sistema es la app, no un sitio web.
 * El middleware ya manda a `/dashboard` a quien tiene sesion, asi que esto
 * solo le toca a quien no esta logueado.
 */
export default function Home() {
  redirect("/login");
}
