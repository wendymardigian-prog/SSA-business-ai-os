# Cola de WhatsApp de las automatizaciones

Traída de RER-BAIOS el 18/11/2026 y construida encima de la cola de los broadcasts (`docs/broadcasts.md`). Migraciones
`00420_whatsapp_send_queue` y `00421_send_queue_cron_guard`.

## Qué hace

Los WhatsApp de las automatizaciones que pueden salir en ráfaga entran en `send_queue_items` y salen de a uno por el
**carril del número** (`channel_send_lanes`), el mismo que usan los broadcasts: espera al azar, horario de envío del
número, topes por minuto, hora y día. Pantalla: **Automatizaciones → Cola** (`/dashboard/flows/cola`, pide
`channels.manage`).

## Qué va por la cola (decisión de Wendy del 18/11/2026)

Cada paso de WhatsApp («Enviar mensaje» por WhatsApp, «Enviar WhatsApp a un número», «Enviar al grupo» y la votación a un
grupo) tiene «Cómo sale por WhatsApp»:

| Opción | Qué hace |
|---|---|
| **Según el disparador** (lo de siempre, también en los pasos viejos) | Si la automatización arranca porque el contacto escribió (palabra clave, botón, respuesta rápida, primer mensaje, cualquier mensaje, comentario) o por su agenda, **sale al instante**. Si arranca por otra cosa (etiqueta, alta de contacto, formulario, fecha, webhook, ventas, servicios), **va por la cola**. Un paso a un **grupo** sale al instante (un solo mensaje, con hora fija). |
| Por la cola del número | Siempre por la cola. |
| Al instante | Siempre en el momento (el camino de siempre, sin tocar). |

La lista de disparadores «al instante» vive en `lib/send-queue/automation/settings.ts` y `instant-triggers.test.ts` la
ata al registro.

## Las reglas (puras, en `lib/send-queue/automation/*`)

- **Ritmo**: el del número (`channels.send_policy`; sin guardar, `DEFAULT_WHATSAPP_POLICY`), no el de RER.
- **Reserva de urgentes**: 20 % del cupo de la hora. Lo normal, lo masivo **y los broadcasts** usan como mucho el resto
  (con 60/h, 48). Lo urgente con la reserva gastada caduca.
- **El cupo cuenta TODO lo que sale por el número** (`send_lane_counts`): broadcasts, la cola, lo que escribe el equipo,
  el celular, el agente, las secuencias, las automatizaciones al instante y los grupos. Lo manual nunca se frena: el
  cuadro de escribir avisa si el cupo de la hora o del día está gastado.
- **Calentamiento**: escalera de tramos («N días al X %») desde que se conectó el número o desde «volver a calentar».
  Baja los topes de la hora y del día de la cola y de los broadcasts.
- **Prioridad, caducidad y límite por hora** en el disparador de cada automatización (`data.whatsappQueue`).
- **Programados**: «N minutos/horas/días después de que corre el paso», con el texto congelado; «Aplicar a los envíos
  programados» recalcula lo que no salió (lo que ya tendría que haber salido queda vencido).
- **Reintentos**: transporte a 1, 5 y 15 minutos; un rechazo no se reintenta. Un `sending` colgado queda fallido.
- **Tope por contacto y día**: se trae **apagado** (3 por contacto y 3 por grupo al prenderlo; lo urgente no cuenta).
- **Alerta si un número deja de entregar**: con pendientes y ninguna entrega durante 30 minutos (configurable) dentro del
  horario y con cupo, se pausa el carril y se avisa a Owner y Admin.
- **Pausar lo masivo** de un número frena también sus broadcasts.

## Qué NO se trajo

Número de salida por CSM / número general (escribir desde otro número es escribir en frío), respuesta fuera de horario
(decisión de Wendy), tipos de mensaje con propuestas de IA (P-55), avisos de agenda descartados al cancelar, Slack y GHL.

## WhatsApp simulado

`EVOLUTION_FAKE_API=1` (solo fuera de producción, `lib/evolution/fake-mode.ts`): nada sale de la PC. Números que terminan
en `4004` se rechazan, en `5003` fallan por transporte y en `0000` no tienen WhatsApp.
