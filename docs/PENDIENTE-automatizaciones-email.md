# Automatizaciones de email y envíos programados — pendientes

## Para Wendy (fuera del código)

- **Reactivar el webhook de Resend.** Resend lo tiene desactivado (`webhook_disabled = "true"`); SSA no lo reactiva a propósito. Pasos:
  1. Entrar a resend.com/webhooks y activarlo.
  2. En SSA, ir a Ajustes → Integraciones → Resend y tocar «Actualizar webhook».

  Sin esto no llegan los rebotes ni las quejas, y el freno automático de la Fase 1a no tiene con qué decidir.
- **Elegir el «Máximo de emails de marketing por día»** antes del webinar. El default es 100. Con 1.000 y el calentamiento prendido, desde el jueves 5/11 salen 100 + 200 + 400 + 94, y los 794 terminan el domingo 8/11.

## Abiertos

- **Clic y apertura en condiciones (A3, Fase 2).** La 1a empieza a guardar `opened_at` / `clicked_at` en `email_log`; la condición «abrió / hizo clic en el email del paso X» queda para A3.
- ~~**`lib/vault-boundary.test.ts` se queda sin tiempo con la suite entera.**~~ Resuelto el 4/11: con la máquina cargada (carga 46 por otras sesiones) el `it` que recorre los imports pasaba los 5 s incluso solo; se le dio un tiempo propio de 30 s. No cambia nada de lo que comprueba.
- **La fecha fija del nodo «Esperar» se convierte con la zona del navegador** (`DelayPanel.tsx`), no con la del negocio. Se arregla en A4.

## Conversaciones (verificado el 4/11/2026, sin construir)

**1. El email de un broadcast NO queda como mensaje saliente en la conversación de email del contacto.**
- La cola (`deliverEmail`, `lib/send-queue/dispatch.ts`) manda con `sendTransactionalEmail` y anota solo en `email_log` (`related_entity_type = 'broadcast'`). Devuelve `conversationId: null`, no abre ni toca la conversación y no inserta en `messages`. Lo mismo pasa con el paso «Enviar email» de los flujos.
- Se ve en el historial de la ficha (sección Historial, con entregado/abrió/clic desde la 1a), no en la bandeja.
- Lo que haría falta: después de un envío `ok`, abrir (o reusar) la conversación del contacto en el canal de email (`upsertConversation`, sin sumar no leídos) e insertar el saliente con `origin: "broadcast"`, el asunto y el id de Resend (`platform_message_id`). Después, guardar `conversation_id` en el destinatario (la lista ya muestra «Ver chat» si existe). Cuidado con los triggers de `messages` (último mensaje, «Esperando respuesta»): un saliente de broadcast cuenta como respuesta automática, no humana (`chat_reply_is_human`).

**2. Una respuesta a wendy@ o a hola@mail.wendymardigian.com entraría en la conversación de email del contacto, pero HOY NO LLEGA.**
- Configuración real: remitente de importantes `baios@mail.wendymardigian.com`, de marketing `wendy@mail.wendymardigian.com`, sin `reply_to`, recepción prendida en el dominio `mail.wendymardigian.com` (canal `hola@mail.wendymardigian.com`, activo).
- Por código, sí entraría: la respuesta va a la dirección de marketing (no hay `reply_to`). El receptor (`/api/webhooks/resend-inbound`) ubica el canal por dirección exacta y, si no, por **dominio** (`resolveInboundChannel`): wendy@ y hola@ caen en el mismo canal. `processInboundEmail` busca o crea el contacto por el remitente y usa SU conversación en ese canal (una por contacto, `upsertConversation`). No depende del hilo (`In-Reply-To`): entra igual aunque el broadcast no haya dejado mensaje.
- **No llega hoy porque el webhook de Resend está desactivado** (`webhook_disabled = "true"`), y por ahí viene también `email.received`. Al reactivarlo (resend.com/webhooks → activar; en SSA, Resend → «Actualizar webhook»), entran las respuestas, los rebotes y las quejas.
- No lo pude comprobar sin llamar afuera: que los MX de `mail.wendymardigian.com` apunten a la recepción de Resend. «Probar» en la tarjeta de Resend dice si el dominio de recepción está verificado.
