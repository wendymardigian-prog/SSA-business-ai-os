/**
 * «Correr una sola vez por contacto» del disparador «Webhook recibido» (Tirón 2, C2): qué pasos mandan algo a la
 * persona y el texto corto que el editor muestra. Puro: el panel lo compone.
 */
import { canonicalNodeType } from "@/lib/flow-engine/node-outputs";

/** Los pasos que le MANDAN algo a la persona (o lo programan): repetirlos es repetirle mensajes. */
export const SENDING_NODE_TYPES: readonly string[] = [
  "sendMessage",
  "sendAsset",
  "aiResponse",
  "send_email",
  "send_whatsapp_number",
  "commentReply",
  "privateReply",
  "enrollSequence",
];

export function flowSendsMessages(nodes: ReadonlyArray<{ type?: string | null; data?: unknown }>): boolean {
  return nodes.some((n) => SENDING_NODE_TYPES.includes(canonicalNodeType({ type: n.type ?? "", data: n.data })));
}

export const ONCE_PER_CONTACT_LABEL = "Correr una sola vez por contacto";

/** Qué hace la opción. */
export const ONCE_PER_CONTACT_HELP =
  "Una persona que ya pasó por este flujo no vuelve a entrar cuando manda otro envío (por ejemplo, si llena el formulario dos veces). Su contacto se actualiza igual, pero el flujo no se ejecuta otra vez.";

/** La sugerencia del editor: solo cuando el flujo manda mensajes y la opción está apagada. */
export function oncePerContactHint(args: { enabled: boolean; sendsMessages: boolean }): string | null {
  if (args.enabled || !args.sendsMessages) return null;
  return "Este flujo manda mensajes: si la misma persona puede llenar el formulario más de una vez, conviene encender esta opción para no mandárselos de nuevo.";
}
