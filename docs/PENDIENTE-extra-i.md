# Pendiente — Extra I (Métodos de pago, Gastos, Atribución orgánica y Comisiones)

Formato de cada entrada: **qué quedó**, **por qué**, **qué se decidió**. Avance general en `docs/PROGRESS-extra-i.md`.

---

## Para después del merge

### 00233, 00234 y 00235 (se escriben y se ensayan, NO se aplican en la corrida)

- **Qué quedó:** tres migraciones que encolan trabajos en producción.
  - `00233` — programa la tarea de `pg_cron` `finance-daily` (cada hora, minuto 7).
  - `00234` — trigger `contacts_comment_backfill` en `contacts` y el barrido inicial de comentarios (un job por workspace).
  - `00235` — trigger `payments_enqueue_commissions` en `payments`.
- **Por qué:** si se aplicaran antes del merge, producción encolaría trabajos de tipos que todavía no conoce (`finance_daily`, `comment_backfill`, `comment_backfill_workspace`, `commissions_payment`), los marcaría fallidos y se perdería el barrido inicial de comentarios y las comisiones de los primeros cobros.
- **Qué se decidió:** la corrida las escribe, las ensaya dentro de `BEGIN; … ROLLBACK;` para comprobar que compilan, y prueba sus funciones de trigger llamándolas directo en los `verify-*`. Se aplican después de mergear y de que Railway termine de desplegar, en este orden: 00233, 00234, 00235.
- **Cómo se aplican (Wendy, con el prompt "Después del merge" del archivo de construcción):**
  1. `git checkout main && git pull origin main`; confirmar que las tres están en `supabase/migrations/`.
  2. `list_migrations`: las anteriores del Extra I aplicadas y estas tres no.
  3. Correr `verify-contacts-single-entry.mjs` y `verify-sales.mjs` (punto de partida).
  4. Aplicar con `supabase db query --linked -f <archivo>`, registrar en `supabase_migrations.schema_migrations` y correr `node scripts/build-all-migrations.mjs`. Después de cada una:
     - 00233 → `node scripts/verify-expenses.mjs --despues-de-00233`
     - 00234 → `node scripts/verify-organic-attribution.mjs --despues-de-00234` y `verify-contacts-single-entry.mjs`
     - 00235 → `node scripts/verify-commissions.mjs --despues-de-00235` y `verify-sales.mjs`
  5. Comprobar: `select jobname, schedule from cron.job where jobname = 'finance-daily'` y `select status, count(*) from scheduled_jobs where type like 'comment_backfill%' group by 1` (repetir hasta que no queden pendientes).
- **Cómo se vuelve atrás:** 00233 → `select cron.unschedule('finance-daily');`. 00234 → `drop trigger contacts_comment_backfill on contacts;` + cancelar los `scheduled_jobs` pendientes de `comment_backfill%` (los toques creados quedan: son verdaderos). 00235 → `drop trigger payments_enqueue_commissions on payments;` + cancelar los `commissions_payment` pendientes (las comisiones ya generadas quedan).

---

## Puntos a confirmar con Wendy

### Permiso para elegir el responsable de una publicación sin pieza (Social)
- **Qué quedó:** `social_posts.assigned_to` (publicaciones externas o marcadas a mano) necesita un selector en Social.
- **Por qué:** el detalle de una publicación en Social es de solo lectura (`social.view`); hoy no existe ninguna edición de una publicación externa.
- **Qué se decidió:** acción nueva protegida con `content.publish`, que es el permiso que ya gobierna marcar y desmarcar una publicación como subida a mano. Si preferís otro (por ejemplo `content.create` o `social.view` + Admin), se cambia en una línea.

### Respuesta a historias → pieza (F33)
- **Qué quedó:** no se pudo verificar en el código que `social_posts.external_post_id` de una historia coincida con el `storyId` que manda Zernio. Ningún código ni test los cruza, y una historia publicada a mano probablemente no tiene fila en `social_posts`.
- **Por qué:** `recordInboundTouch` hoy solo guarda `storyId` en `raw.story_id`.
- **Qué se decidió:** se construye de forma defensiva (busca por plataforma + `external_post_id`, solo si hay una única fila en el workspace; si no, el toque queda como hoy) y se prueba con datos sembrados. Falta confirmarlo en vivo con una historia real publicada por el sistema.

### Comisión de Whop
- **Qué quedó:** los 5 métodos de pago arrancan con comisión 0 % + 0, **Whop incluido** (decisión del 11/10/2026).
- **Por qué:** hasta que Wendy confirme el porcentaje real, un valor inventado distorsionaría las comisiones y los gastos automáticos.
- **Qué se decidió:** el backfill de la 00224 mantiene 0; Wendy carga los valores reales desde Ajustes > General > Ventas > Métodos de pago.

### Avisos de comisión y privacidad
- **Qué quedó:** un aviso de comisión dirigido a una persona (`commission_generated`) lo puede ver también todo Owner/Admin.
- **Por qué:** la regla `can_see_notification` (que no se toca) deja ver todas las notificaciones del workspace a Owner y Admin.
- **Qué se decidió:** se documenta; los avisos llevan solo el monto agregado y el contacto de la venta, nunca datos de pago.

---

## Diferencias entre el plano y el código real

Las 30 diferencias detectadas al planificar están numeradas en la sección 2 del plan (`docs/PROGRESS-extra-i.md`). Las que dejan trabajo o una decisión abierta:

- **Diferencia 9 — alcance `commissions` en ~12 lugares escritos a mano:** se hace en CM1, junto con la 00231 y el cambio aprobado M9; se lista cada archivo en PROGRESS al cerrar CM1.
- **Diferencia 14 — atribución manual de la venta hoy no crea toque:** F47 cambia el significado (ahora crea el toque y manda su `touch_id` a `create_sale`). La edición de la venta tiene su propio camino y se cubre por separado.
- **Diferencia 28 — `docs/roles.md` documenta `verify-rls --despues-de-00208`, pero el script ignora ese flag:** se corre con el flag vigente (`--despues-de-00143`). Corregir el doc queda para el cierre.

---

## Entradas de la corrida

_(Se agregan a medida que se construye: bloques trabados, nice-to-have que no entraron, verificaciones que fallaron y cómo volver atrás.)_

## GF18 — Generar faltantes con vista previa (nice-to-have, sin hacer)
Al reactivar una plantilla pausada la pantalla avisa qué fechas de pago se saltearon (`missedDatesOnReactivate`), pero no ofrece crearlas con un botón. Si Wendy lo quiere: una acción «vista previa» (solo lecturas) y otra «confirmar» (inserta con `ON CONFLICT DO NOTHING`), con tope de 366 días.

## Gastos automáticos: dos cosas a mirar en vivo
- Con Whop en 0 % (hasta que Wendy cargue el real) encender «Comisiones de procesadores» no crea ningún gasto: es lo esperado.
- La pantalla de Recurrentes y la de Ajustes > Finanzas > Gastos automáticos no se vieron en un navegador (pide sesión): revisar a 1440 y 390 px.

## F33 — historias: confirmar en vivo
`resolveStoryPiece` busca `social_posts.external_post_id = storyId` (una sola fila, mismo workspace y red). No se pudo verificar que el id de la historia que manda Zernio en `metadata.storyReply.storyId` coincida con el `external_post_id` que guarda el sistema para una historia publicada: si no coincide, el toque queda como antes (sin pieza). Probar con una historia real.

## Mensajes con pieza (F34/F35)
- `{{content.title}}` y `{{content.code}}` salen en los flujos de comentario y en los de mensaje que vienen de una historia propia, de la respuesta a un DM de automatización o de un anuncio vinculado a una pieza. Si no hay pieza, el token queda escrito tal cual (así funciona la interpolación para cualquier variable).
- La herencia de pieza mira el último DM saliente con `origin_context.content` en la conversación; se prueba con datos sembrados, no con Zernio real.

## F48 — Contenido que vende (nice-to-have, sin hacer)
Las columnas por pieza (leads, agendas, ventas, revenue, cash) con una función `content_crm_metrics(p_since, p_until)` (SECURITY INVOKER, mismo patrón que `ads_crm_metrics`) quedaron afuera. La venta ya muestra su pieza y su responsable, y el dashboard de Contenido no cambió.

## Reordenar reglas de comisión: ventana de milisegundos
`reorderCommissionRules` y archivar renumeran una fila por vez (el cliente de Supabase no da una transacción propia); entre movimiento y movimiento puede haber un orden intermedio visible para el motor durante milisegundos. Si molesta, una RPC `reorder_commission_rules` en una migración futura lo vuelve atómico.

## Catálogo de Meta en «Cargar a mano»
El buscador de anuncios usa la sesión de quien carga la venta, así que sin `dashboards.ads.view` no ve el catálogo y queda «No sé qué anuncio». Si se quiere que cualquiera con `sales.manage` pueda buscar, hay que pasar a cliente de servicio.

## F65 — Recalcular comisiones pendientes (nice-to-have, sin hacer)
Falta la acción de servidor que arme la vista previa (antes → después) de las comisiones Pendientes o Retenidas sin gasto y las recalcule (anula con motivo «Recalculada» y vuelve a generar por pago). Nunca debe tocar las que están en un gasto.

## Revisión visual con datos
**Decisión de Wendy (15/10/2026): no se cargan datos de prueba en el workspace real; esta revisión se hace después del merge**, con los primeros gastos, comisiones y pagos reales (o los que cargue ella). Lo visto hasta ahora: Resumen, Gastos, Recurrentes, Proveedores, Comisiones y Reglas con la base vacía, a 375/390 y 1440 px, en tema claro y oscuro, sin desborde ni errores de consola. Falta mirar con datos: filas de gastos y comisiones, el diálogo «Generar gasto», el panel de reglas y su arrastre, el chip «Vino de…» en la bandeja, la línea de tiempo de toques y «Cargar a mano» en una venta.

## `verify-attribution`: 59 contactos de la sincronización del buzón sin primer toque (anterior al Extra I)
El check «todos los contactos reales tienen first_touch» falla desde antes de esta corrida: 59 contactos «Instagram User» se dieron de alta el 2026-10-06 entre las 21:56 y las 21:57 UTC (la sincronización del buzón, que no pasa por el receptor ni emite `contact_created`; dos emitieron después un evento con `source: "unknown"` al ponerles nombre). No hay de dónde sacar un toque y no se les inventó uno ni se relajó el check. **Resuelto el 15/10/2026 con la opción (b), que eligió Wendy:** se creó un toque `import` (fuente `instagram`, `occurred_at` = fecha de alta del contacto, `dedupe_key` = `backfill-extra-i:<contacto>`) para cada uno de los 59, con `record_contact_touch` (sin tocarla). Respaldo previo de ids, fechas y atribución en `docs/extra-i/respaldo-toques-import.json`. Para deshacerlo: borrar de `contact_touches` las filas con `dedupe_key like 'backfill-extra-i:%'` y recalcular `contacts.attribution` de esos contactos con `private.refresh_contact_attribution`. `verify-attribution` da 883 de 883 y exit 0.
