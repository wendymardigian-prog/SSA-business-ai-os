/**
 * Si por este canal se puede mandar un archivo.
 *
 * Hoy la respuesta es "todos menos email": `sendViaResendChannel`
 * (lib/flow-engine/send.ts) solo manda `message.text` e IGNORA
 * `message.media` sin avisar, asi que dejar pasar un audio ahi no da
 * error -- manda un email con la transcripcion y deja una fila con un
 * adjunto que nunca salio.
 *
 * Un predicado y no tres chequeos de `provider === "resend"` desparramados:
 * el picker de la bandeja, la API de envio manual y el agente tienen que
 * decir lo mismo, o la bandeja termina mintiendo sobre que se puede mandar.
 */
export function channelAcceptsMedia(provider: string | null | undefined): boolean {
  return provider !== "resend";
}
