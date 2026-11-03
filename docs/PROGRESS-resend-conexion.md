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
- [ ] **R3 · El secreto deja de depender de la recepción**: `?w=` en el receptor, rebotes y quejas sin recepción activa, `last_event_at`.
- [ ] **R4 · Recepción por dominio**: canal por dominio, la respuesta sale desde la dirección a la que escribieron, el estado del dominio y "Responder a" sugerido.
- [ ] **R1 · Una sola tarjeta**: `resend_inbound` oculta y redirigida; Conexión, Remitentes, Webhook y Recepción en la tarjeta Resend.
- [ ] **R5 · Checklist y "Probar"**: estado con ✓/✗ y una prueba de solo lectura.
- [ ] **R6 · Textos**.
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
