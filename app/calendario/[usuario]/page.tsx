import { notFound } from "next/navigation";

/**
 * `/calendario/<usuario>` sin evento: 404 a proposito (decision del plano).
 *
 * No hay pagina publica con la lista de eventos de una persona: cada link se
 * comparte solo. Existe este archivo para que la respuesta sea un 404 claro y
 * no un error de ruta.
 */
export default function UsuarioSinEvento() {
  notFound();
}
