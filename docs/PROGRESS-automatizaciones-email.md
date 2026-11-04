# Automatizaciones de email y envíos programados — avance

Rama de la Fase 1a: `feat/automatizaciones-email-envios`. Plan aprobado el 4/11/2026.

## Decisiones (4/11/2026)

- **La Fase 1 se parte en dos PR.**
  - **1a (urgente)**: la guardia única de entrega (A6) aplicada a broadcasts, flujos y secuencias, más A9 de broadcasts. PR y freno: el primer email del webinar del 9/11 sale por broadcast.
  - **1b**: A1 + A2 + A9 de flujos, sobre la misma guardia, en una rama nueva desde `main`. PR y freno.
  - **Fase 2** en otra rama.
- **El tope viejo de 100 del nodo «Enviar email» se reemplaza por la guardia**: no conviven dos. La cuota del plan de Resend (`daily_quota`) aplica solo si está cargada, y vive dentro de la guardia.
- **Tope del día = el más bajo** entre «Máximo de emails de marketing por día» (default 100) y el escalón del calentamiento (100 → 200 → 400 → 800 → terminado).
- **Tabla nueva aprobada: `automation_runs`** (1b). Es la única: `trigger_fires` no sirve de ancla porque su FK a `triggers` borra en cascada y publicar recrea las filas de `triggers`.
- **No hay un segundo motor de envío masivo.** Los broadcasts de email ya existen (cola de envíos, carril del canal de email). A1 solo arranca sesiones de flujo; lo que regula el envío es una sola guardia para todo el marketing.
- **A1 pide además `broadcasts.manage` y alcance de leads `all`** (un Member tiene `flows.publish`). No se crea ningún permiso.

## Punto de partida (4/11/2026)

- Base: última migración aplicada **00286** (`send_queue_cron`, versión `20261104044906`) → **próxima libre 00287**.
- `npm ci`: hizo falta. El `node_modules` de la copia no tenía `frimousse` y `components/automations/step-tree-render.test.ts` no cargaba. Después de instalar: 15/15.
- `npx vitest run`: 1188 archivos, 15.249 tests. Una corrida da 1 timeout en `lib/vault-boundary.test.ts` (5 s, con la máquina cargada); solo pasa 112/112 en 3,5 s. Ver PENDIENTE.
- `npm run lint`: 0 errores, 37 avisos.
- `npm run build`: 0.
- Verificaciones, de a uno con el candado, desde la carpeta principal (el `.env`) con el código de esta rama:
  - `verify-email-subscription`: 54 ok, todo verde.
  - `verify-broadcasts`: 21 ok, todo en verde.
  - `verify-rls --despues-de-00143 --despues-de-00208`: 293 ok, todo verde.
- Datos: `Wendy's Workspace` tiene 2.346 contactos `subscribed` y 107 `unsubscribed` (los ~794 del webinar son un subconjunto filtrado). `email_log`: 7 `sent`, 26 `failed`, 1 `skipped_not_configured`.
- **El webhook de Resend figura desactivado** (`webhook_disabled = "true"`): Resend lo devolvió con `status: "disabled"` al conectar y SSA no lo reactiva a propósito. Escucha `received`, `bounced`, `complained`, `delivered`, `opened`, `clicked` y `failed`, pero el receptor solo procesa los tres primeros.

## Migraciones

| Número | Nombre | Fase | Orden | Estado |
|---|---|---|---|---|
| 00287 | `email_delivery_guard` (columnas de `email_log`, estados `reserved` / `skipped_no_email`, `reserve_email_send`, `settle_email_send`, `contact_last_activity`) | 1a | antes del deploy | sin escribir |
| 00288 | `broadcast_activity_order` (`broadcast_recipients.sort_key`, `claim_broadcast_recipient` ordenado por actividad) | 1a | antes del deploy | sin escribir |
| 00289 | `automation_runs` (tabla, CHECK de `triggers.type` + `scheduled_audience`, índice único de `flow_sessions`, índice de `scheduled_jobs`) | 1b | antes del deploy | sin escribir |
| 00290 | `email_default_design` (`workspaces.email_default_design`) | 2 | antes del deploy | sin escribir |

Confirmar cada número con `list_migrations` y las ramas locales antes de escribirla.

## Fase 1a — guardia única de entrega + A9 de broadcasts

- [ ] Caracterización antes de tocar:
  - [ ] el HTML que sale hoy del nodo «Enviar email»;
  - [ ] `templates.ts`;
  - [ ] `deliverEmail` de broadcasts;
  - [ ] el paso de email de secuencias;
  - [ ] `canSendEmailTo`;
  - [ ] `resumeSession`;
  - [ ] el procesador de flujos con disparadores por evento.
- [ ] 00287 y 00288: ensayo en una transacción que se deshace, aplicación, registro, `build-all-migrations` y tipos.
- [ ] A6 · La guardia (`lib/email/delivery-guard.ts` + la gemela SQL `reserve_email_send` + `delivery-guard.cases.json`):
  - [ ] tope por día del negocio;
  - [ ] cuota del plan solo si está cargada;
  - [ ] calentamiento;
  - [ ] pausa;
  - [ ] reserva atómica en `email_log`.
- [ ] A6 · `sendTransactionalEmail` y `sendEmailReply` reservan antes de mandar y actualizan la fila después.
- [ ] A6 · Broadcasts:
  - [ ] el carril de email espera a `retryAt` y no gasta intento;
  - [ ] consulta el cupo antes de reclamar;
  - [ ] orden por actividad (`sort_key`).
- [ ] A6 · Flujos:
  - [ ] se borra el tope viejo de 100;
  - [ ] `deferred` vuelve a correr el mismo paso (`rerunNode`).
- [ ] A6 · Secuencias: `deferred` deja el paso para `retryAt`.
- [ ] A6 · Freno:
  - [ ] el receptor marca `bounced_at` / `complained_at` en `email_log`;
  - [ ] evalúa 2 % / 0,05 % con un mínimo de 50 en 24 h;
  - [ ] pausa el marketing y avisa (`email_marketing_paused`).
- [ ] A6 · Bajas atribuidas: `?e=<email_log_id>` en el link y el header de baja, y `unsubscribed_at`.
- [ ] A6 · Pantalla «Entrega de marketing» en la tarjeta de Resend: máximo por día, calentamiento y su día, freno con «Reanudar».
- [ ] A6 · Aviso rojo del webhook (desactivado o sin `bounced` / `complained`) en el editor de broadcast, el nodo «Enviar email» y la tarjeta de Resend.
- [ ] A9 · Progreso del broadcast:
  - [ ] pendientes por tope o pausa;
  - [ ] rebotes, quejas y bajas de ese email;
  - [ ] la lista filtrable con link a la ficha.
- [ ] Cierre 1a:
  - [ ] la sección en `CLAUDE.md`;
  - [ ] `docs/envios-programados-email.md` (el webinar por broadcast);
  - [ ] `verify-email-subscription` con la reserva concurrente;
  - [ ] `verify-broadcasts` con el orden;
  - [ ] el PR.

## Fase 1b — A1 + A2 + A9 de flujos

- [ ] A1 · Disparador `scheduled_audience`:
  - [ ] registro, catálogo, valores por defecto y variables;
  - [ ] configuración: «Una vez» / «Repetir», audiencia con los filtros de Contactos, categoría, escalonar (120 min), tope por disparo.
- [ ] A1 · Vista previa de la audiencia en el panel:
  - [ ] N;
  - [ ] salteados por motivo;
  - [ ] 10 nombres con link.
- [ ] A1 · Al publicar:
  - [ ] el run y el trabajo `automation_run_fire`;
  - [ ] validar la fecha futura y avisar si la audiencia es 0.
- [ ] A1 · El disparo:
  - [ ] la lista en ese momento, en orden por actividad, con el tope por disparo;
  - [ ] lotes de 25 escalonados;
  - [ ] idempotencia por el índice único de `flow_sessions`.
- [ ] A1 · Ejecutar ahora (con el conteo), pausar, reanudar, cancelar y la repetición.
- [ ] A1 · `audit_log` y permisos (`flows.publish` + `broadcasts.manage` + alcance `all`).
- [ ] A2 · Nodo «Enviar email»:
  - [ ] la categoría heredada del disparador;
  - [ ] el respaldo `{{x|y}}` y `{{x | "y"}}`;
  - [ ] sin email → `skipped_no_email` + `node_skipped`;
  - [ ] `flow_node_id` / `automation_run_id` en `email_log`;
  - [ ] el reclamo en `flow_send_claims`.
- [ ] A9 · La pestaña «Envíos» de la automatización: los runs, los números por nodo de email y la lista de destinatarios.
- [ ] Test de punta a punta: 5 contactos (2 dados de baja, 1 sin email) → 5 sesiones, 2 emails, 3 salteados; reprocesar no repite.
- [ ] `scripts/verify-automation-runs.mjs`.
- [ ] Cierre 1b: `CLAUDE.md`, la guía con la automatización y el PR.

## Fase 2 — A3, A4, A5, A7, A8, A10

- [ ] A3 · Verificar las condiciones de email, etiquetas y campos; clic y apertura solo si llegan por el webhook.
- [ ] A4 · «Esperar hasta» en la zona del negocio:
  - [ ] tres salidas si ya pasó;
  - [ ] «X antes / después de una fecha»;
  - [ ] tests con reloj simulado y cambio de horario.
- [ ] A5 · `lib/email/designs.ts`:
  - [ ] Carta, Con marca, Simple y Sin diseño;
  - [ ] `renderEmail`;
  - [ ] `templates.ts` pasa a usarlo (snapshot antes);
  - [ ] `workspaces.email_default_design`.
- [ ] A7 · Botón e imagen en el editor, el preheader con contador y `sanitizeEmailHtml` con los dos bloques nuevos (tests de seguridad).
- [ ] A8 · `components/email/email-preview.tsx`:
  - [ ] `buildEmail()` compartido con el envío (test de igualdad);
  - [ ] «Ver como»;
  - [ ] «Enviarme una prueba» (5 por minuto).
- [ ] A10 · Remitente del nodo, con respaldo al del negocio si el dominio dejó de estar verificado.
- [ ] Cierre Fase 2: snapshot de los emails del sistema, caracterización de los nodos sin diseño y el PR.
