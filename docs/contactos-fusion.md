# Fusión de contactos

Unir dos contactos (el duplicado y el principal) mueve **todo** lo que colgaba del duplicado al principal, en una sola transacción. Lo
hace la función de base `merge_contacts` (migración **00207**); `linkContacts` (`lib/actions/contacts.ts`, solo Owner/Admin) comprueba
permiso y que los dos contactos se vean y le delega con el cliente de servicio. La función solo la ejecuta `service_role`: ni el Owner
con su sesión la puede llamar directo.

## Qué se mueve (las 25 relaciones con `contacts`)

`CONTACT_MERGE_TABLES` (`lib/contacts/merge.ts`): `agent_drafts`, `agent_runs`, `analytics_events`, `automation_events`, `bookings`,
`broadcast_recipients`, `calls`, `contact_channels`, `contact_custom_fields`, `contact_notes`, `contact_tags`, `contact_touches`,
`contacts` (`referred_by_contact_id`), `contact_status_changes` (el historial de estados, desde la 00247), `contract_signatures`, `conversations` (y los mensajes de las que se unifican), `email_log`,
`flow_sessions`, `form_submissions`, `inbound_webhooks`, `sales` (los pagos y demás cuelgan de la venta y la siguen),
`sequence_enrollments`, `social_post_comments`, `tasks`, `trigger_fires`.

**Guardia de deriva:** `scripts/verify-contact-merge.mjs` lee el catálogo (claves foráneas y columnas `contact_id`) y falla si aparece
una relación que no esté en esa lista ni en `CONTACT_MERGE_EXCLUSIONS` (con su motivo). **Una tabla nueva con `contact_id` se suma a
`merge_contacts` y a `CONTACT_MERGE_TABLES` en el mismo cambio.**

## Reglas de conflicto

- **Estados y producto de interés (00247):** el estado de setter y el de vendedor del principal se conservan; el que le falte se completa
  con el del duplicado (con su fecha) y el último estado se recalcula. El producto de interés del principal gana; si no tiene, se toma el
  del duplicado con su variante. Ver [pipeline-contactos.md](pipeline-contactos.md).

| Qué | Regla |
|---|---|
| Conversaciones (única por canal + contacto) | Si el principal ya tiene una en ese canal, los mensajes del duplicado pasan a la suya (los que repiten el id de mensaje de la plataforma quedan en la vieja y se cuentan); se recalcula el resumen (último mensaje, sin leer sumados, abierta si alguna lo estaba); la del duplicado queda vacía y con borrado lógico. Un borrador abierto repetido se descarta. Las demás se mueven enteras. |
| Etiquetas, campos personalizados | Se mueven los que el principal no tiene; en un campo repetido gana el del principal. |
| Secuencias (una inscripción viva por secuencia) | Si el principal ya está activo o pausado, la viva del duplicado se cancela con el motivo «fusion de contactos»; el resto se mueve. |
| Sesiones de flujo | Las activas se mueven salvo que el principal tenga una activa del mismo flujo (la del duplicado se cancela). El historial se mueve siempre. |
| Eventos de automatización | Los pendientes del duplicado NO se mueven (podrían disparar otro flujo para el principal): se marcan cancelados. Los procesados se mueven. |
| Tareas | Si los dos tienen un seguimiento para la misma fecha (`followup:<fecha>`), el del duplicado pasa como tarea normal (sin la clave). Ninguna se pierde. |
| Toques de atribución | Se mueven todos y la atribución del principal se **recalcula con todos** (primer y último toque). `record_contact_touch` no se toca. |
| Formularios «una vez por contacto» | `contact:<id>` pasa a `contact:<principal>` salvo que el principal ya tenga una para ese formulario. |
| Identidad | Los datos vacíos del principal se completan con los del duplicado (y `next_followup_date`), nunca al revés. Las notas se juntan. El duplicado queda con `deleted_at` y `metadata.merged_into` **antes** de rellenar (así un índice único por teléfono o email sobre contactos vivos no choca). |
| Ventas, pagos, agendas, llamadas | Solo cambian de dueño: ni montos, ni estados, ni horarios. |

## Resultado y pantalla

La función devuelve cuántas filas movió por tabla y deja la entrada `link` en el historial del principal (misma transacción, con quién
la hizo). `summarizeMerge` arma la frase («Se unificaron 2 conversaciones, 1 agenda y 3 tareas.»). El banner de vinculación pasa al
duplicado como el contacto que se mira, que queda borrado: por eso, al terminar, va a la **ficha del principal** con el resultado como
cuentas en la URL (`?fusion=conversations.2,tasks.3`, solo claves conocidas y números) y `MergeNotice` lo muestra.

## Vuelta atrás

El duplicado es reversible durante 30 días (borrado lógico), pero lo que se movió al principal no vuelve solo: queda en el historial del
principal qué se movió. Para deshacer una fusión hay que reasignar a mano.
