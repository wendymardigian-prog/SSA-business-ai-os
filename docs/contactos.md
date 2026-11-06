# Contactos: la regla única "buscar o crear"

Cómo se reconoce a una persona y cómo nace un contacto. Plan y decisiones en `docs/PROGRESS-contactos.md`; pendientes en `docs/PENDIENTE-contactos.md`.

## La regla

**Todo contacto nuevo nace en un solo lugar**: la función de la base `find_or_create_contact` (migración `00200`), que en TypeScript se usa siempre por `lib/contacts/find-or-create.ts` (`findOrCreateContact` y `findContact`, que solo busca). Dos llegadas simultáneas de la misma persona dan **un** contacto: la base bloquea por dato antes de buscar.

**Qué es un dato fuerte** (lo que identifica a una persona): el canal junto con el id del remitente, el teléfono, el WhatsApp, el email (y el secundario) y los usuarios de Instagram, TikTok, X, LinkedIn y Facebook. **Nunca el nombre.** Facebook solo busca cuando lo manda un canal de Facebook; los formularios no lo usan para buscar.

**Cómo se normaliza** (`lib/contacts/identity.ts` y su gemela SQL `private.contact_normalize_identity`, con los mismos casos en `lib/contacts/identity.cases.json`): el teléfono queda `+<dígitos>` (8 a 15 dígitos; menos no cuenta como dato, `normalize_phone` = `normalizePhone`), el email en minúsculas y sin espacios, los usuarios sin "@" y en minúsculas, LinkedIn como URL canónica por su slug.

**Orden de búsqueda**: canal → teléfono (primero el `phone` recibido, después el WhatsApp; cada uno contra las dos columnas) → email (principal, después secundario; cada uno contra las dos columnas) → Instagram → TikTok → X → LinkedIn → Facebook. Gana el primero que encuentra un contacto (el más antiguo, solo vivos). Los demás datos que apuntan a **otro** contacto son conflictos (`conflict_contact_id` y `conflicts: [{ by, contact_id }]`): nada se fusiona solo.

**Modalidades**: `create` (busca y, si no está, crea), `link_channel` (igual, y al crear deja la fila de `contact_channels`; la usan los mensajes entrantes) y `find_only` (solo busca, con los mismos bloqueos). Sin ningún dato fuerte devuelve `no_identity` y no crea nada. **Solo el alta manual** puede crear con el nombre solo (`allowWithoutIdentity`).

**Qué inserta**: las columnas de los `defaults`, sin dejar pisar `id`, `workspace_id`, `deleted_at`, `created_at`, `updated_at` ni las columnas de identidad, que salen siempre de la identidad normalizada. Si un índice único (00205) le gana la carrera, vuelve a buscar y devuelve al que estaba.

## Quién la usa

| Camino | Cómo |
|---|---|
| Mensajes entrantes (Zernio, Evolution, email, comentarios, backfill) | `find_or_link_contact` v3 (00202) → central en `link_channel` |
| Agenda | `create_booking` v3 (00203) → central; sin email ni teléfono se rechaza (`CB001`) |
| Formularios | `submit_form_response` v6 (00204) → central en `find_only` (resolver) y `create` (crear) |
| Alta manual, CSV, Ventas, webhooks, comentarios de TikTok | TypeScript → `findOrCreateContact` |
| Buscadores (`find_contact_for_form`, `find_contact_by_phone_or_email`) | 00201: la misma búsqueda compartida (`private.contact_identity_lookup`), sin crear |

## Un teléfono o email que ya es de otro contacto

- Al **completar** un contacto (formulario, agenda, CSV, webhook, mensaje entrante), ese dato **se saltea** y se anota el conflicto. El resto de los campos se completa como siempre.
- En la ficha, al **restaurar** un contacto borrado y al **fusionar**, aparece un error claro ("Ese teléfono ya es de otro contacto").
- El alta manual de un **Member** con un dato que es de un contacto que no ve responde "Ya existe un contacto con ese dato. Pedile a un Admin que te lo asigne.", sin enlace ni nombre. Owner, Admin o quien lo ve van a la ficha, como siempre.
- El CSV suma al reporte "vinculadas a un contacto que ya existía" por teléfono, email y usuario de red, y cuántos datos no se escribieron por ser de otro contacto.

## Cómo se vigila

- `lib/contacts/single-entry.test.ts` falla si algún archivo de la app hace `.from("contacts").insert/upsert`.
- `scripts/verify-contacts-single-entry.mjs` contra la base real: ninguna función de la base salvo la central inserta en `contacts`; los casos de identidad SQL ↔ TS; la central; 10 llamadas simultáneas con el mismo teléfono o el mismo email (mayúsculas distintas) dan un contacto; los índices de la 00205.
- `lib/contacts/c2-migrations-diff.test.ts` fija línea por línea qué cambió en las tres funciones reescritas.

## Índices únicos (00205)

Un teléfono o un email principal solo puede ser de un contacto **vivo** por workspace (`uq_contacts_workspace_phone`, `uq_contacts_workspace_email`). Están escritos y ensayados, pero **se aplican después de desplegar el PR** (ver `docs/PENDIENTE-contactos.md`).

## Quién queda oculto (00295)

Un contacto sin nombre propio (vacío, «Instagram User» o un id numérico) y sin
email, teléfono, WhatsApp ni @ de Instagram es **anónimo**: no aparece en la lista
salvo con el filtro «Sin datos», y `contact_created` y la asignación esperan a que se
identifique. Lo calcula la base (`is_anonymous`), así que se apaga solo. Es sobre la
identidad, no sobre el trabajo hecho. Detalle en
[flujo-de-mensajes.md](flujo-de-mensajes.md) («El contacto sin identificar»).

## Lista: vistas, columnas y filtros (3/11/2026)

La lista de contactos tiene dos vistas con los MISMOS filtros: la tabla y el Kanban (`?vista=kanban`, agrupado por estado de setter o de vendedor).

- **Un solo planificador**: `lib/contacts/list-query.ts` lee la URL (`parseContactListFilters`) y arma la consulta (`contactListPlan`). Lo usan la tabla, cada columna del Kanban y "Cargar más". Qué filtros existen lo dice el catálogo: `lib/contacts/filters/catalog.ts` (los de la tabla `contacts`) más las áreas de `lib/contacts/related/*`, registradas en `lib/contacts/list-modules.ts`.
- **Cada filtro valida lo suyo** (`accepts`): un uuid, una clave de estado, un valor de lista cerrada o un texto seguro (`isSafeText`, sin comillas ni barras). Lo inventado se ignora. Varias opciones = "cualquiera de" (`?setter=a&setter=b`); un link viejo de un valor sigue andando.
- **Fechas** (`lib/contacts/filters/dates.ts`): un atajo (`hoy`, `7d`, `vencido`, `sin`, `proximas`…) o un rango `AAAA-MM-DD..AAAA-MM-DD`, contados en la zona de quien mira.
- **Registros relacionados**: "tiene" es un join `!inner`, y todas las condiciones de "tiene" sobre una misma tabla van en el mismo join (una agenda que cumple todo); cada "no tiene" es un anti-join propio (`is null`). Respetan la RLS de cada tabla (`relatedPlan`).
- **Columnas** (`lib/contacts/columns.ts`): Nombre fija; las de siempre visibles y las nuevas ocultas. Lo que ve cada persona vive en `localStorage` (`contacts-columns`, formato `{ v: 2, visible }`; el formato viejo se migra). Las de la fila del contacto se arman en el servidor (`contactCells`); las de registros relacionados se piden después de dibujar, solo para la página visible y solo las visibles (`loadContactColumnCells` → `loadRelatedCells`).
- **Sumar un filtro o una columna** es una entrada en el catálogo o en el área que corresponda; la pantalla no cambia. Un área de un módulo que la plantilla de estudiantes no lleva (Ventas, Formularios, Tareas, Llamadas) va en su archivo, listado en `scripts/plantilla/perfiles/estudiantes.mjs`, y su línea de `list-modules.ts` lleva la marca.
- **Migración `00283_contacts_list_filters`** (aditiva): `contact_attribution_options` (SECURITY INVOKER, las opciones de campaña, contenido y término) e índices para los filtros nuevos. Sin ella, esos tres filtros quedan sin opciones y no se muestran; el resto anda igual.
