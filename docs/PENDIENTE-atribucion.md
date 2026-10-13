# Pendiente · Webhooks entrantes, atribución y anuncios (Extra L)

Formato de cada entrada: **qué quedó**, **por qué**, **qué se decidió**.
Avance: [PROGRESS-atribucion.md](PROGRESS-atribucion.md).

## Punto de partida

- **`verify-attribution.mjs` falla antes de empezar.** Un caso, "todos los contactos reales tienen
  first_touch" (775 de 834). Es una comprobación de datos del backfill de la 00115 sobre contactos reales:
  los contactos creados después no tienen toque. Ya lo había anotado Formularios. **Decidido:** se anota y
  no puede empeorar; los demás casos pasan. El conteo sube solo con cada contacto nuevo sin toque.
- **`verify-sales.mjs` falla antes de empezar.** Un caso, "con todas las reglas en manual, crear un
  contacto NO encola nada" (00161). **Decidido:** no es de este módulo; se anota y no puede empeorar.
- **`verify-knowledge.mjs` no se corre** (llama a Voyage de verdad, con costo) y **`verify-webhook.mjs`
  tampoco** (necesita la app corriendo en local). Mismo criterio que Formularios.
- **`verify-rls`, `verify-roles` y `verify-workspace-isolation`** se corren con los flags
  `--despues-de-00143`, `--despues-de-00136` y `--despues-de-00147`, como dejó Llamadas. Ojo con zsh: una
  variable con varios flags sin comillas llega como UN solo argumento; pasarlos escritos a mano.

## Decisiones tomadas con Wendy (12/10/2026)

- **#254 → "solo el último".** Un contacto que ya existía y no tenía toques recibe antes un toque ancla
  `manual` (fecha de creación del contacto) y después el toque del webhook, así `record_contact_touch` no
  se toca.
- **"Asistió"** = `status_group = 'outcome'` de la agenda (el estado "asistió" no existe).
- **Ventas "no canceladas"** = se excluyen `cancelled` y `refunded`.
- **#260** reprocesar vuelve a mandar mensajes, con aviso y confirmación.

## Verificación en vivo (la hace Wendy, §11 del plano)

Pendiente hasta el final de la corrida; se completa con el resultado de cada punto.

- Formulario externo real (Framer, Typeform o Tally) → webhook → contacto con UTMs; repetir el envío no duplica.
- Respuesta a una historia, mención en una historia, anuncio de mensaje a Instagram (**pendiente desde la
  Fase 3**), anuncio de clic a WhatsApp, comentario en un anuncio.
- Agenda desde una landing con `?utm_content={{ad.id}}`; la misma persona navegando a la agenda sin
  parámetros usa la cookie.
- Parámetros de URL de los anuncios en Meta (`utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`).
- Revisión visual en la app con sesión, si no se pudo hacer en la corrida.

## Entradas de la corrida

### WH1 — decisiones que se apartan del plano (qué quedó, por qué, qué se decidió)

- **Las dos tablas de webhooks no tienen policies de INSERT, UPDATE ni DELETE para `authenticated`.** El plano
  decía "INSERT, UPDATE y DELETE con `flows.edit`". **Por qué:** el token se genera en el servidor y no tiene que
  pasar por el navegador, y `has_permission` devuelve false para el Member de sistema (sus claves viven en
  `lib/auth/permissions.ts`) aunque tenga `flows.edit`. **Decidido:** escribe solo el servidor (Server Actions con
  `getPermissionAction("flows.edit")`), la lectura de la pantalla también va por el servidor después de chequear
  el permiso en TypeScript, y la RLS (`has_permission`) queda como segunda barrera más estricta. Lo prueba
  `verify-inbound-webhooks.mjs`.
- **No hay columna `rejected_count_24h`.** El plano dejaba elegir entre esa columna y el limitador. **Decidido:** los
  rechazos por tope los cuenta `bump_rate_limit` (clave `hooks:<endpoint>`, 600 por hora); no se guardan.
- **`webhook_endpoints` suma `last_error_alert_at`** (el último aviso de errores, para avisar una vez por hora) e
  **`inbound_webhooks` suma `processing_started_at`** (el reaper rescata los `processing` colgados: los marca `error`
  para que una persona los reprocese, no los vuelve a correr solos porque ya pudieron mandar mensajes).
- **La retención a 12 meses (borrar la fila) necesita, desde M2, borrar antes las sesiones de flujo terminadas sin
  contacto de ese envío** (su FK es `ON DELETE SET NULL` y dejaría una sesión que viola el CHECK). Hoy no hay
  ninguna; se agrega en WH2 junto con M2.
- **Revisión visual a 1440 px solo en tema oscuro**; el tema claro se miró a 390 px. Los componentes usan solo
  tokens de color (`bg-card`, `border-border`, `text-muted-foreground`…), sin `dark:`.
- **Reprocesar usa `confirm()` del navegador**, como otras confirmaciones simples del sistema.

