# Broadcasts y la cola de envíos

Un broadcast es **un mensaje a muchos contactos**: por WhatsApp (Evolution) o por
email (Resend). Se arma en cuatro pasos y después sale solo, por una **cola de
envíos** que respeta el ritmo de cada canal.

Pantalla: Bandeja → **Broadcasts** (`/dashboard/broadcasts`). Permiso:
`broadcasts.manage` (Owner y Admin; el Member no, M6).

## Los cuatro pasos

1. **A quiénes.** Los MISMOS filtros de la lista de Contactos, con la búsqueda.
   La audiencia se guarda como los parámetros de URL de Contactos
   (`broadcasts.audience_params`) y se re-planifica con el mismo planificador
   (`parseContactListFilters` → `prepareContactList` → `applyListClauses`): un
   filtro nuevo en Contactos aparece solo en Broadcasts. Desde Contactos, con
   filtros puestos, «Mandar un broadcast a estos contactos» arranca un borrador
   con esa audiencia.
2. **Por qué canal.** Los números de WhatsApp conectados con Evolution y el
   canal de email (`lib/broadcasts/channels.ts`). **Instagram queda afuera**: la
   ventana de 24 h no deja escribir en frío y ManyChat es la dueña de los hilos.
   Se ve cuántos reciben y por qué quedan afuera los demás
   (`classifyRecipient`, `lib/broadcasts/audience.ts`, la misma regla al contar
   y al poner en cola).
   - **WhatsApp**: por defecto, solo quien **ya tiene conversación con ESE
     número** (su id en el canal: teléfono o `@lid`). Una casilla suma a quienes
     solo tienen teléfono (nunca escribieron), con aviso de riesgo. Quedan
     afuera «no contactar» y quien no recibe difusiones por chat
     (`is_subscribed = false`).
   - **Email**: sale como **marketing**: no le llega a quien se dio de baja,
     rebota, marcó spam o está «sin suscribir», y lleva el pie y las cabeceras
     de baja (`withUnsubscribe`).
3. **El mensaje.** Variables del contacto, del negocio y de los campos
   personalizados (`{{contact.first_name}}`, `{{workspace.name}}`,
   `{{custom.<slug>}}`), con **valor de respaldo** (`{{contact.first_name|amigo}}`).
   En email, un respaldo vacío saluda bien en los dos casos: `Hola, {{contact.first_name|}}.`
   da «Hola, Ana.» o «Hola.». Y un **texto de vista previa** opcional (el preheader, la línea
   que la bandeja muestra al lado del asunto, `broadcasts.email_preheader`), también con variables.
   Un nombre de relleno (un id o un `@usuario`) cuenta como vacío. Por WhatsApp,
   **hasta 5 versiones**: a cada contacto le toca una (estable por destinatario,
   así un reintento manda la misma). Se puede saltear a quien le falta un dato
   sin respaldo. «Ver cómo les llega» lo arma para contactos reales.
   Todo en `lib/broadcasts/render.ts` (puro: la vista previa y el envío usan lo mismo).
4. **Cuándo y a qué ritmo.** Ahora o programado (hora del negocio). Se ve el
   ritmo del número, la fecha estimada de fin (`estimateFinish`) y se puede ir
   más lento con este broadcast, nunca más rápido.

Al confirmar (`queueBroadcast`, `lib/broadcasts/core.ts`) la audiencia **se
congela**: se resuelve con el cliente de la persona (la RLS decide a quién ve) y
se guarda cada destinatario con su destino y su variante. Los que quedan afuera
también se guardan, como `skipped` con su motivo. Antes de cada envío se vuelve
a mirar lo que pudo cambiar (borrado, no contactar, baja).

Si el filtro lleva etiquetas, también se vuelve a mirar que la persona siga teniendo
alguna: quien ya no tiene ninguna queda salteado (`left_audience`, «Ya no tienen la
etiqueta de la audiencia»). Así no le llega una difusión a quien un flujo sacó de la
lista después de programarla. Si no se puede comprobar, es un fallo que se reintenta.
Sin etiqueta en el filtro no hay ninguna consulta de más. Los demás filtros siguen
congelados.

## La cola de envíos

Un **carril** por canal (`channel_send_lanes`): todo lo que sale por un número
comparte su ritmo, porque WhatsApp bloquea por número. El despachador
(`lib/send-queue/dispatch.ts`, `/api/cron/send-queue`, cada 15 s):

1. mira el ritmo del número (`paceDecision`): horario, máximos por minuto, por
   hora (últimos 60 min) y por día (el del negocio);
2. elige el broadcast más viejo que pueda salir con su propio ritmo;
3. toma el lugar del carril (`claim_lane_slot`: gana uno solo aunque corran dos
   despachadores) y lo corre una **espera al azar** entre el mínimo y el máximo;
4. reserva el próximo destinatario (`claim_broadcast_recipient`), arma el
   mensaje y lo manda por el camino de siempre: `sendChannelMessage` (WhatsApp,
   con el tope de 200/h del canal y la conversación en la bandeja) o
   `sendTransactionalEmail` con `category: "marketing"`.

### Las reglas de ritmo (`lib/send-queue/pace.ts`, puro)

| Regla | WhatsApp (recomendado) | Email |
|---|---|---|
| Espera entre mensajes | 25 a 60 s, al azar | sin espera |
| Máximo por minuto | 2 | 100 (límite de Resend) |
| Máximo por hora | 60 | sin tope |
| Máximo por día | 300 | sin tope |
| Horario | lunes a sábado, 9 a 20 h | a cualquier hora |
| Pausa tras fallos seguidos | 5 | 10 |

- **El techo es del número** (`channels.send_policy`, Canales → el número →
  «Ritmo de envíos masivos», pide `channels.manage`). Sin nada guardado, el
  recomendado.
- **Un broadcast puede ir más lento, nunca más rápido** (`combinePolicies`: de
  cada regla, la más lenta).

### Lo que no se puede romper

- **Un broadcast sale SOLO por `sendChannelMessage` o `sendTransactionalEmail`**
  (`dispatch.test.ts` lo fija). Nada de llamar a Evolution o Zernio directo.
- **Nunca lanza por un fallo del proveedor.** Reintenta a 1, 5 y 15 minutos y
  después `failed`. Un `rate_limited` (el tope de 200/h del canal, llenado por
  otros envíos) espera 5 minutos sin gastar intento. Un fallo que se va a
  reintentar no deja una burbuja roja por intento en el chat.
- **Fallos seguidos pausan el carril** y avisan a Owner/Admin (`channel_error`).
  Se reanuda desde el broadcast («Reanudar envíos»). Sin WhatsApp configurado o
  sin Resend, se pausa al primer fallo.
- **Un destinatario que quedó `sending`** (el proceso murió a mitad del envío)
  pasa a `failed` a los 5 minutos y **no se reintenta**: mandar dos veces es peor
  que no mandar.
- **Un contacto una sola vez por broadcast** (índice único).
- **Un contacto que solo tenía teléfono** primero pasa por una pregunta a Evolution
  (`checkWhatsappNumber`, `lib/send-queue/whatsapp-number.ts`, no le manda nada):
  - **Sin WhatsApp**: se saltea (`no_whatsapp`, «El número no tiene WhatsApp»), sin
    vínculo ni conversación, sin gastar intento y sin contar para la pausa.
  - **Con WhatsApp**: se vincula (`contact_channels`) con el número en la forma que
    usa WhatsApp, que puede diferir del cargado (Argentina, México, Brasil), y se le
    abre la conversación antes de mandar, así el eco y su respuesta caen en el mismo
    chat. Si ese número ya es de otro contacto, se saltea (`phone_in_use`).
  - **Error o respuesta que no se entiende**: un fallo con reintento. Nunca se saltea
    a alguien por una duda.

  Quien ya está vinculado al número no pasa por la pregunta. La forma real de la
  respuesta de Evolution todavía no se vio en vivo: confirmarla en la primera prueba
  con un número inexistente.
- **Los contadores salen de los destinatarios** (`refresh_broadcast_counts`), no
  se suman de a uno. Sin pendientes, el broadcast termina solo.
- **Escribe solo el servidor**: desde la 00285 `broadcasts` y
  `broadcast_recipients` solo se leen con `broadcasts.manage` y no tienen
  políticas de escritura.

## Estados

`draft` (se edita) → `scheduled` (con fecha) → `sending` → `completed`. En el
medio, `paused` (no se toma nada hasta reanudar) y `cancelled` (lo que falta
queda `cancelled`, lo enviado no se deshace). Un destinatario: `pending`,
`sending`, `sent`, `failed`, `skipped` (con motivo) o `cancelled`.

## La API

`GET /api/v1/broadcasts`, `POST /api/v1/broadcasts` (crea un borrador:
`name`, `channelId`, `audienceParams`, `variants`, `emailSubject`,
`includePhoneOnly`, `pace`, `scheduledFor`) y `POST /api/v1/broadcasts/:id/send`
(lo pone en cola). Mismo núcleo que la pantalla.

## Migraciones

- `00285_broadcast_send_queue` (aditiva): columnas nuevas de `broadcasts` y
  `broadcast_recipients`, `channels.send_policy`, `channel_send_lanes`, la RLS por
  permiso, `claim_lane_slot`, `claim_broadcast_recipient` y
  `refresh_broadcast_counts`; cancela los jobs `send_broadcast` viejos. **Va ANTES
  de desplegar el código** (la pantalla lee sus columnas). Aplicada y registrada en
  producción el 3/11/2026 (versión `20261103235025`).
- `00286_send_queue_cron`: reescribe `private.call_app_cron` (suma
  `send-queue`) y agenda el cron cada 15 s. **Va DESPUÉS del deploy** (antes la
  ruta no existe).

```
node scripts/verify-broadcasts.mjs   # RLS, índice único, claim_lane_slot (10 a la vez = 1), claim_broadcast_recipient, contadores
```

## Pendiente

- **La pestaña Broadcasts se le muestra al Member** (la página lo saca con
  `requirePermission`). Ocultarla pide pasar los permisos a `SectionTabs`.
- **Media en WhatsApp** (imagen, audio, recurso de la banca) todavía no: solo texto.
- **Instagram**: queda afuera. Si algún día se suma, solo para quien tenga la
  ventana de 24 h abierta (`reply_window_until`).
- **Calentamiento de un número nuevo** (empezar con pocos por día e ir subiendo):
  hoy se hace bajando el máximo por día a mano.
- **La audiencia se congela al confirmar**: un programado no suma a quien entre
  a los filtros después (solo saca a quien perdió la etiqueta del filtro).
