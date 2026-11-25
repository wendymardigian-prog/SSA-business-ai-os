# Fallos del sistema: avisos para Owner y Admin

Desde el 25/11/2026 (traído de RER-BAIOS), cuando algo del sistema deja de funcionar, Owner y Admin reciben un aviso.
Se configura en **Mi cuenta → Notificaciones → «Fallos del sistema»**, que solo ven Owner y Admin. Llega por
**campana, email y Slack**, los tres prendidos de entrada; **WhatsApp apagado** (cada persona lo prende si quiere).
Cada persona puede apagar el canal que no quiera.

## Qué avisa

| Tipo de aviso | Cuándo | Dónde se detecta |
|---|---|---|
| `system_job_failed` | Un trabajo de la cola (`scheduled_jobs`) se da por perdido después de sus intentos | `app/api/cron/jobs/route.ts` → `lib/jobs/failure-alert.ts` |
| `meta_ads_sync_failed` | No se pudieron traer los anuncios de una cuenta, o falta su token | `lib/jobs/handlers/meta-ads-sync.ts` |
| `meta_capi_failed` | Un evento de la API de Conversiones queda `failed` | `lib/meta/capi/run.ts` |
| `slack_connection_error` | Slack rechaza el token del bot (al mandar un aviso o en el paso «Enviar a Slack») | `lib/integrations/slack-alert.ts` |
| `email_provider_error` | Resend responde 401 o 403 | `lib/email/provider-alert.ts` |
| `zernio_key_error` | Zernio responde 401 | `lib/integrations/zernio-alert.ts` |
| `google_business_token_error` | No se renueva una conexión OAuth del negocio al leer métricas | `lib/jobs/handlers/metrics-sync.ts` |
| `render_not_configured` | Falta `RENDER_SERVICE_URL` / `RENDER_SERVICE_SECRET` | `lib/designer/jobs/render.ts` |
| `team_connection_lost` | A alguien del equipo se le corta su Google Calendar o su Fathom (copia del aviso que le llega a esa persona) | `lib/google-calendar/auth.ts`, `lib/fathom/auth.ts` |

El aviso de Slack antes salía como «Una integración necesita atención» y solo desde la entrega de avisos; ahora es
este. «El agente tuvo un problema» pasó a tener el email prendido de entrada, como los demás avisos de fallos.

## Reglas

- **Un solo camino**: `notifySystemFailure` (`lib/notifications/system-alerts.ts`). Nunca lanza y va sin
  `recipient_id`. Así lo entregan a Owner y Admin el job de entrega (`deliveryRecipients`) y la campana:
  `can_see_notification` se lo oculta a un Member porque `entity_type` es `system`. El destino del clic sale de
  `metadata.area` (`SYSTEM_AREA_LINKS` en `lib/notifications/types.ts`).
- **Solo al momento**: no se repite el mismo aviso (tipo + clave) en 7 días, **leído o no**. Lo que tiene estado (las
  conexiones personales) además avisa solo en la transición de bien a mal.
- **Sin datos sensibles**: el detalle pasa por `sanitizeRunText` y se recorta. Nunca lleva el payload de un job, una
  clave, un email ni un teléfono. El nombre de la persona del equipo sí; su email nunca.
- **Sin bucles**: el job que entrega los avisos (`notification_deliver`) no avisa de su propio fallo, igual que los
  trabajos que ya tienen su aviso propio (`JOB_TYPES_WITH_OWN_ALERT`). Un aviso por Slack que falla porque Slack está
  cortado deja un solo aviso por semana.
- **Solo Owner y Admin**: el evento `system_failures` es `audience: { kind: "admins" }` sin permisos. `eventVisibleTo`
  lo esconde de la pantalla y `setNotificationPref` rechaza en el servidor cualquier evento que no sea para el rol de
  la persona.
- **Sin migración**: `notifications.type` no tiene CHECK (00051) y la entidad `system` no necesita columnas.
- **Un trabajo nuevo** suma su nombre en `JOB_LABELS`. Si no, el aviso muestra el tipo técnico.
- **Un fallo nuevo** suma su tipo en `NOTIFICATION_TYPES` y `SYSTEM_DEFINITIONS` (`types.ts`), en el evento
  `system_failures` (`preferences.ts`) y en `SystemFailureType` (`system-alerts.ts`).
- `svcRpc` guarda el texto original de la base en `error.technical`, solo para logs y avisos internos (nunca en
  pantalla). `svc_daily` lo usa para decir por qué falló.

## Lo que todavía no avisa

- **La app entera caída** (Railway). La app no puede avisar de sí misma: hace falta un vigilante externo.
- **El secreto del cron que no coincide, o la cola trabada.** El aviso se mandaría por el mismo cron que está fallando.
- **El webhook de Resend que deja de recibir** (`last_event_at` viejo).
- **Una salud periódica de Zernio.** Hoy solo se detecta cuando una llamada recibe un 401.
- **Un trabajo sin `workspaceId` ni `workspace_id` en el payload** (por ejemplo `resume_flow`). Solo se loguea.
