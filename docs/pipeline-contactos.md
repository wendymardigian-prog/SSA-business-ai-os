# Pipeline de contactos

Cada contacto tiene un **estado de setter** y un **estado de vendedor** (closer), un **producto de interés** con variante opcional, y
campos personalizados que se comportan según su tipo. Migraciones `00244` a `00248` (aplicadas el 21/10/2026).

## Estados de setter y de vendedor (00245)

- **Dos estados, una lista cada uno.** Viven en `workspaces.contact_status_settings` (`{ setter: [...], closer: [...] }`, cada estado
  `{ key, name, color, archived_at }`). Se editan en **Ajustes → Estados** (permiso `contact_statuses.manage`). La `key` no cambia nunca;
  un estado no se borra, se archiva (el contacto que ya lo tiene lo conserva y se ve "(archivado)"). Los estados por defecto son los de
  `DEFAULT_CONTACT_STATUSES` (`lib/contacts/statuses.ts`) y la misma lista es el default de la columna, como literal (00248):
  `statuses.test.ts` las compara.
- **El último estado** es el que se cambió más recientemente de los dos (empatados, el del vendedor). Es lo que se ve en la cabecera de la
  ficha y en la columna "Estado" de la lista. Se guarda en `contacts.last_status_role` / `last_status` / `last_status_at`.
- **Un solo camino para cambiar un estado: `set_contact_status`** (solo `service_role`). En una transacción bloquea el contacto, valida el
  estado contra la lista (no archivado), escribe, recalcula el último, anota el cambio en `contact_status_changes` y emite el evento
  `status_changed`. El núcleo en TypeScript es `applyContactStatus` (`lib/contacts/status-core.ts`); la acción de la ficha y la bandeja es
  `setContactStatus` (`lib/actions/contact-status.ts`: pide `contacts.edit` y que la persona VEA el contacto).
- **La guardia `contacts_status_guard`** rechaza (`CS001`) cualquier cambio directo a esas columnas, también del service role. Solo pasan
  `set_contact_status` y `merge_contacts`, que ponen la marca `app.contact_status_internal`.
- **El historial** (`contact_status_changes`) lo lee quien ve el contacto (`can_see_contact`): el setter ve también los cambios del
  vendedor, cosa que con `audit_log` no pasaría. Nadie lo escribe a mano. Aparece en el historial de la ficha (`lib/contacts/history.ts`).
- **Automatizaciones:** el disparador "Evento del CRM" → "Cambió el estado del contacto", filtrable por rol o por rol y estado
  (`setter:calificado`). Condiciones `contact.setter_status`, `contact.closer_status` y `contact.last_status` (este último como `rol:clave`).

### El agente de IA y el estado de setter

- La herramienta **`cambiar_estado_setter`** (`lib/agent/tools/setter-status.ts`) mueve SOLO el estado de setter; el de vendedor nunca.
  Nace apagada. Se configura con la lista blanca de estados que puede poner (los activos) y "Puede pisar un estado que puso una persona"
  (apagado por defecto: `contacts.setter_status_by_agent` dice si el actual lo puso el agente).
- La **clasificación al cierre** también puede moverlo (`estado_setter`), con la misma regla y solo si el agente tiene la herramienta.
  Sin la herramienta, el prompt es idéntico al de antes (`instructions.test.ts`).
- Lo que hace queda como acción `setter_status` en el audit (pestaña Acciones) y **se puede revertir**: vuelve al estado anterior por
  `set_contact_status`, así también queda en el historial.

## Producto de interés (00246)

- `contacts.interest_product_id` y `contacts.interest_variant_id` (opcional). El trigger `contacts_interest_check` exige que la variante
  sea de ese producto (`CI003`), que una variante tenga producto (`CI001`) y que el producto sea del workspace (`CI002`).
- Se elige en la ficha y en la bandeja (`InterestFields`, `setContactInterest`, `contacts.edit`). Solo se ofrecen productos y variantes
  activos; uno archivado que el contacto ya tenía se conserva. Una variante sin precio se puede elegir: es interés, no una venta.
- "Nueva venta" desde la ficha arranca con ese producto (y la variante, si se puede vender: `initialProduct`).
- Condición de flujo `contact.interest_product`. Columna y filtro en la lista de contactos.

## Campos personalizados confiables (00244)

- **Un solo normalizador** (`normalizeCustomValue`, `lib/custom-fields.ts`): lo usan la ficha, el paso "Definir campo", la importación y
  el webhook. Número con punto decimal (acepta "3,5"), sí/no como `true`/`false`, fecha `AAAA-MM-DD` (acepta `DD/MM/AAAA`).
- `contact_custom_fields.value_number` y `value_date` los llena un trigger que nunca lanza (lo que no se puede convertir queda en `NULL`).
  Con eso "más de 3 viajeros" compara números (antes "10" < "9"). Los usan los segmentos y el filtro de la lista.
- La lista de contactos permite sumar campos personalizados como columna (preferencia por persona, `localStorage`) y filtrar por uno
  (`?campo=<slug>&op=gt&valor=3`; también "está vacío" y "tiene un valor").
- La importación por CSV ofrece cada campo como destino y lo reconoce por el nombre de la columna.

## Fusión (00247)

`merge_contacts` mueve `contact_status_changes` y completa en el principal el estado de cada rol que no tenga, y el producto de interés
(con su variante). Ver [contactos-fusion.md](contactos-fusion.md).

## Nivel de calificación (00329)

Un número del **1 al 5** por contacto (o «Sin calificar»), que convive con la temperatura. Lo que tiene que cumplir un lead para
estar en cada nivel lo decide cada negocio.

- **Los 5 niveles son fijos; se edita el nombre y la descripción** (la rúbrica) en **Ajustes → Estados → «Calificación del lead»**
  (permiso `contact_statuses.manage`). Se guardan en `workspaces.qualification_settings` (`{ levels: [{ level, name, description }] }`),
  con un DEFAULT literal igual a `DEFAULT_QUALIFICATION_SETTINGS` (`lib/contacts/qualification.ts`). Por defecto: No califica, Bajo,
  Medio, Bueno, Ideal.
- **Una sola puerta**: `set_contact_qualification` (solo `service_role`; núcleo `applyContactQualification`,
  `lib/contacts/qualification-core.ts`). Modos `set` (1-5), `add` (suma o resta, recorta entre 1 y 5; desde «Sin calificar» cuenta
  desde 0, así que +1 da 1 y restar no hace nada) y `clear`. La regla de recorte es gemela de `nextQualificationLevel`, con los
  casos de `lib/contacts/qualification.cases.json`. La guardia `contacts_qualification_guard` (QL001) rechaza cualquier otra
  escritura; `qualification-single-entry.test.ts` lo exige en el código.
- **Cada cambio** deja su fila en `contact_qualification_changes` (antes, después, `source`: persona, agente, automatización,
  importación, fusión o siembra; quién, el flujo y el motivo) y emite `qualification_changed` (`level`, `previous_level`,
  `direction`). La siembra y la fusión no emiten evento.
- **Dónde se ve y se cambia**: ficha (sección «Calificación» y la insignia de la cabecera), panel de la bandeja, columna y filtro
  `?calif=` de la lista (también en la audiencia de un broadcast) y el Kanban agrupado por calificación (`?agrupar=calificacion`:
  arrastrar una tarjeta cambia el nivel).
- **Automatizaciones**: el paso «Calificar lead», la condición «Calificación del lead (1 a 5)» y el disparador «Cambió la
  calificación» (ver [flow-registry.md](flow-registry.md)).
- **El agente de IA**: la herramienta `calificar_lead` y la clasificación al cierre (ver [agente-ia.md](agente-ia.md)).
- **Importar CSV**: la columna «Calificación» (también «nivel», «score», «puntaje») acepta del 1 al 5 y entra por la misma función
  con origen `import`. «Temperatura» sigue yendo a la temperatura.
- **Fusión**: no se reescribió `merge_contacts`. El trigger `contacts_qualification_on_merge` mueve el historial y deja al principal
  con el nivel más alto (por eso la tabla está en `CONTACT_MERGE_EXCLUSIONS`).
- **La siembra (una vez, en la 00329)**: los contactos con temperatura y sin nivel arrancaron con frío = 2, tibio = 3, caliente = 4.
  La 00329 se aplicó el 8/11/2026 UTC (versión `20261108071521`): 17 contactos quedaron en nivel 2 y 54 en nivel 3.

## Verificación

```
node scripts/verify-contact-pipeline.mjs        # 00244-00246 contra la base
node scripts/verify-contact-merge.mjs           # incluye los estados y el producto de interés
node scripts/verify-contact-qualification.mjs   # 00329: la regla SQL = TS, la función, la guardia, la RLS, concurrencia y fusión
```
