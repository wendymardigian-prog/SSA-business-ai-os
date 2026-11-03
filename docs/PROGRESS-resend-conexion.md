# Conexión de Resend en un clic y recepción por dominio — avance

Rama `feat/resend-conexion`, desde `origin/main` en `a1a8503` (2/11/2026). Pendientes y decisiones en
[PENDIENTE-resend-conexion.md](PENDIENTE-resend-conexion.md).

## Punto de partida (medido el 2/11/2026, de a uno)

- `npx vitest run`: 1150 archivos, 14826 tests, todo verde.
- `npm run build`: salida 0.
- `npm run lint`: 0 errores, 37 avisos.
- Con el candado `/private/tmp/ssa-verify.lock`: `verify-email-subscription.mjs`, `verify-workspace-isolation.mjs --despues-de-00143` y `verify-rls.mjs --despues-de-00143` en verde.
- Base de producción (`knrxjnmx…`): última migración `00276`, igual que el repo. Entre la Fase A y la creación de la rama se mergeó el PR #111 (web externa y «Sin suscribir»), con la `00277` y la `00278` ya aplicadas: la rama sale de ahí (`c1dfa1b`), y el punto de partida medido lo incluye. Hay una sola fila `integration_configs` `email_provider/resend` (con `from_email` y `from_name`), ninguna `resend_inbound` y ningún canal de email.

## Checklist

- [x] Caracterización (`route.received.test.ts`, 8 casos, en verde contra el código de antes): el receptor (`email.received` con dirección exacta, firma inválida, duplicado, dirección desconocida), el "desde" de la respuesta y la elección del secreto. En verde antes de tocar nada.
- [x] **R2 · Webhook automático**: URL en `lib/webhook-url.ts`, `lib/email/resend-webhook.ts` (crear, adoptar, nunca tocar uno ajeno), las acciones y la conexión sola al guardar una key de acceso completo.
- [x] **R3 · El secreto deja de depender de la recepción**: `?w=` en el receptor, rebotes y quejas sin recepción activa, `last_event_at`.
- [x] **R4 · Recepción por dominio**: canal por dominio, la respuesta sale desde la dirección a la que escribieron, el estado del dominio y "Responder a" sugerido.
- [x] **R1 · Una sola tarjeta**: `resend_inbound` oculta y redirigida; Conexión, Remitentes, Webhook y Recepción en la tarjeta Resend.
- [x] **R5 · Checklist y "Probar"**: estado con ✓/✗ y una prueba de solo lectura.
- [x] **R6 · Textos**.
- [ ] Cierre: `CLAUDE.md`, `docs/integraciones.md`, verificación final y PR.

## Diferencias entre el pedido y el código real

- Ya existe `lib/email/receiving.ts` (trae el email completo de Resend). Las funciones puras nuevas de la recepción por dominio van en `lib/email/inbound-address.ts`.
- `testConnection` no probaba Resend (`default: ok`). Se suma un caso: `GET /domains`.
- El webhook de Zernio se registra en `app/api/v1/channels/test-key` y `.../sync`, no en `saveIntegration`. El de Resend sí va en `saveIntegration`, porque Resend usa el formulario genérico.
- `resend_inbound` se editaba con `channels.manage` (era un proveedor de Canales, y la RLS de la 00213 lo deja pasar). La recepción pasa a la tarjeta Resend y pide `integrations.manage`. Es más estricto para quien solo tenía `channels.manage`; Owner y Admin no cambian. La política de la 00213 no se toca.
- `webhook_events` no tiene workspace y se purga a las 48 h: no sirve para "último aviso". La 00279 suma `integration_configs.last_event_at`.
- La lista de eventos vive en `lib/email/resend-events.ts` (pura, la muestra la pantalla); `lib/email/resend-webhook.ts` la re-exporta como `RESEND_WEBHOOK_EVENTS`.
- `IntegrationCardData.config` es `Record<string, string>`: el estado nuevo se guarda en claves planas de texto (`access`, `webhook_id`, `webhook_events`, `webhook_connected_at`, `webhook_secret_saved_at`, `webhook_needs_secret`, `receiving_enabled`, `receiving_domain`, `receiving_local`), no en un objeto anidado.
- Lo que dice la documentación de la API de Resend:
  - `POST /webhooks` y `GET /webhooks/{id}` devuelven `signing_secret`. La lista no es confiable para eso.
  - `PATCH` reemplaza `events`.
  - `GET /domains` trae `capabilities.receiving` y `status`.
  - Una key de solo envío recibe 401 `restricted_api_key`.
  - `email.received` trae `to`, `cc` y `received_for`.
  - El MX de recepción no se puede confirmar registro por registro, así que "Recepción activa" = `receiving === "enabled"` + `status === "verified"`, con esa aclaración en pantalla.

## Hecho por requisito

- **R2**: `lib/webhook-url.ts` (`"resend"`, `resendWebhookUrl`); `lib/email/resend-api.ts` (llamada clasificada y `probeResendKey`); `lib/email/resend-webhook.ts` (dueño del webhook, crear, adoptar, actualizar, inspeccionar; sin borrar); `lib/email/resend-config.ts` (claves planas); `lib/email/resend-connection.ts` (núcleo: Vault y config); `lib/actions/resend-connection.ts` (conectar, pegar y quitar el secreto); `testConnection` prueba Resend; `saveIntegration` conecta sola con acceso completo. Tests: `resend-webhook.test.ts` (18, incluido «nunca toca uno ajeno»), `resend-connection.test.ts` (12), `integrations-resend.test.ts` (6), `resend-connection.test.ts` de acciones (4) y `test-connection.test.ts` (+5).
- **R3**: el receptor (`app/api/webhooks/resend-inbound/route.ts`) lee `?w=`. Con el parámetro verifica SOLO con el secreto de ese negocio, tanto rebotes y quejas como emails; sin él, todo como antes. Un `w` que no es un UUID da 401. `touchLastEvent` anota `last_event_at` (solo esa columna, a lo sumo una vez por minuto, en `after()`). En el mismo cambio, el receptor ya ubica el canal por dominio (R4, `lib/email/inbound-address.ts`): comparten el código. Tests: `route.domain.test.ts` (14: rebote y queja sin canal, dos negocios, `?w=` con firma ajena → 401, el último aviso, dominio, copia oculta, mismo dominio en dos negocios con y sin `?w=`) e `inbound-address.test.ts` (11). La caracterización y los rebotes de antes siguen en verde sin cambios.
- **R4**: `lib/email/inbound-address.ts` (dominio, destinatarios con `received_for`, canal por dirección exacta y después por dominio, `ambiguous` con dos negocios, `replyFromAddress`, la etiqueta «para:»). `sendEmailReply` responde desde la dirección a la que escribió la persona si es del dominio del canal; si no, desde la principal; con remitente de marketing, ese «Responder a». `ResendDomain.receiving` sale de `capabilities.receiving` y `receivingState` da activa / falta MX / falta Receiving / no se sabe. `saveReceiving` (núcleo) y `saveResendReceivingAction` (`integrations.manage`): prendida, el canal único del negocio queda con `<usuario>@<dominio>`; apagada, el canal se desactiva. El dominio tiene que estar en la cuenta si se puede listar (plan B: escrito a mano). Avisa si Receiving no está activo o si otro negocio usa el mismo dominio. La bandeja muestra «para: …» en los entrantes, y los remitentes sugieren la principal como «Responder a» (sin guardarla sola). Tests: `send-reply.domain.test.ts` (5), `resend-connection.test.ts` (+8) y `senders.test.ts` (+2).
- **R5**: `lib/email/resend-status.ts` (puro) arma la lista: key y acceso, remitente con dominio verificado, webhook con los 3 eventos (o qué falta: conectar, pegar el secreto, eventos, desactivado), recepción (activa / falta Receiving / falta MX / no se sabe) y el último aviso («hace X»). `checkResendConnectionAction` («Probar») consulta a Resend la key, el webhook y los dominios, SOLO lectura (`checkResendLive`: `GET /domains` y `GET /webhooks`), sin escribir ni mandar nada. Tests: `resend-status.test.ts` (10), `resend-connection.test.ts` (Probar solo lee) y las acciones (+3).
- **R1**: `resend_inbound` queda `visible: false` (sigue en el catálogo para leer filas viejas) y su URL redirige a `/dashboard/settings/integrations/resend`. El aviso de cuota («emails hoy») pasa a la tarjeta Resend y `warnIfNearQuota` lee el `daily_quota` de `resend`. Se saca de `saveIntegration` el bloque que creaba el canal desde la tarjeta vieja (ya no se podía alcanzar). `components/settings/integrations/resend-card.tsx`: Estado (con «Probar»), Conexión (el formulario de siempre más «Conectada · acceso completo / solo envío»), Remitentes (E8, sin cambios salvo la sugerencia de «Responder a»), Webhook (URL con Copiar, eventos, estado, Conectar/Actualizar, el secreto «Guardado el …» con Reemplazar y Quitar, y el plan B paso a paso con el campo `whsec_…`) y Recepción (interruptor, dominio con su estado o a mano, dirección principal). La página carga los datos con el cliente de servicio DESPUÉS del permiso (`loadResendPanelData`), sin llamar a Resend. Tests: `resend-card.test.ts` (7, con el render inicial). Los tests de catálogo (`catalog-characterization`, `providers`, `grid-filter`) se actualizaron SOLO en lo de `resend_inbound` oculta, marcados como cambio aprobado.
- **R6**: en la tarjeta, «Con él SSA comprueba que el aviso viene de Resend. Se obtiene solo al conectar el webhook.» (Webhook), «Los emails que te escriban a cualquier dirección de este dominio entran a la bandeja como conversaciones.» (Recepción) y el link «Cómo activar Receiving en Resend» a `https://resend.com/docs/dashboard/receiving/custom-domains`. Lo fija `resend-card.test.ts`. La guía de configuración está en `docs/integraciones.md` («Email: la tarjeta Resend»).

## Migraciones

- **`00279_resend_unified`** (la `00277` y la `00278` las tomó el PR #111), aditiva e idempotente:
  - `integration_configs.last_event_at timestamptz`.
  - Copia los datos de cada `resend_inbound` al `config` de la fila `resend` del mismo negocio, sin pisar nada; si no hay fila `resend`, la crea inactiva.
  - No borra ni desactiva `resend_inbound`. En producción no copia nada (0 filas).
  - Puede ir antes del deploy. **La próxima libre queda en la `00280`.**
  - Ensayada en producción dentro de una transacción que se deshizo sola: con dos filas `resend_inbound` de prueba y corrida dos veces, copia los datos, conserva el remitente y crea la fila inactiva donde no había. **Aplicada y registrada** el 3/11/2026 (versión `20261103010606`). Comprobado después: la columna existe, la copia no hizo nada (0 filas) y la fila `resend` no cambió.

## Cambios de comportamiento visibles

- La tarjeta "Resend (email entrante)" desaparece del listado, y su URL redirige a "Resend".
- Guardar una key de Resend ahora la prueba contra Resend: una key inválida no se guarda. Una de solo envío se guarda y se marca "solo envío".
- Con una key de acceso completo, guardar crea (o adopta) el webhook de SSA sola.
- Un email a cualquier dirección del dominio de recepción entra a la bandeja, y la respuesta sale desde la dirección a la que escribió la persona.
- La bandeja muestra "para: …" en los emails entrantes.
- El aviso de cuota ("emails hoy") pasa a la tarjeta Resend.

## Riesgos y cómo volver atrás

- **Receptor:** la URL sin `?w=` sigue funcionando igual que antes (hay test). Volver atrás es revertir el PR; los webhooks creados con `?w=` siguen llegando a la misma ruta.
- **Migración:** `ALTER TABLE integration_configs DROP COLUMN IF EXISTS last_event_at;`. Las claves copiadas al `config` de `resend` se borran con `config - 'receiving_enabled' - 'receiving_domain' - 'receiving_local' - 'webhook_secret_saved_at'` (detalle en la cabecera de la migración).
- **Nada externo durante la construcción:** la API de Resend está simulada en todos los tests. El webhook real lo dispara Wendy desde la pantalla, después del deploy.
