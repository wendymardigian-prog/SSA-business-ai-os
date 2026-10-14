# Atribución

De dónde llegó cada contacto, y qué pieza de contenido lo trajo. Se construyó
en Contenido v3 (B11, F81 a F88, más F101 a F105 para mostrarlo). El plano está
en [requerimientos-contenido-v3.md](requerimientos-contenido-v3.md).

## La idea en una frase

Cada vez que pasa algo que dice "esta persona nos conoció así", se anota un
**toque**. El **primer toque** es el crédito de quien trajo al lead; el
**último** es lo más reciente. Con los toques se contesta "cuántos contactos
trajo este reel" sin adivinar.

## El vocabulario es cerrado (F81)

Sin una lista cerrada no se puede agrupar: si un contacto entra como
"instagram", otro como "IG" y otro como "Instagram DM", "cuántos leads trae
Instagram" no tiene respuesta. Cinco campos, cada uno con su pregunta
(`lib/contacts/taxonomy.ts`):

| Campo | Pregunta | Ejemplos |
|---|---|---|
| `source` | Dónde pasó | instagram, tiktok, youtube, linkedin, whatsapp, email, web, manual, csv… |
| `medium` | Cómo llegó | dm, comment, story_reply, paid_social, form, booking, import… |
| `campaign` | La campaña u oferta | texto libre |
| `content` | La pieza concreta | el título de la pieza o el inicio del caption |
| `term` | La palabra clave | texto libre |

**Lo que no está en la lista no se descarta:** se guarda crudo (en minúsculas) y
el medio queda marcado `medium_raw`, para que los agrupadores sepan que ese
valor no es uno conocido. Perder un `utm_source` raro es perder justo lo que
alguien se tomó el trabajo de etiquetar. Los alias que no dejan duda (`ig`,
`yt`, `tt`, `wa`…) se normalizan; los ambiguos no.

## Dónde vive (F82, F83)

- **`contact_touches`** (migración 00114): una fila por toque. La lee quien puede
  ver al contacto (el mismo alcance de leads de siempre: un Member ve los
  suyos). **Solo escribe el servidor.** Se borra en cascada con el contacto.
- **`contacts.attribution`**: una **copia derivada** con el primer y el último
  toque (`{ version: 2, first_touch, last_touch }`), para filtrar sin un JOIN. Se
  recalcula **desde la tabla**, nunca se edita a mano. Tiene índices por
  expresión sobre la fuente, el medio y la pieza del primer toque.
- **`record_contact_touch`** (función de la base, solo para el servicio): inserta
  el toque y recalcula primero y último. Es **idempotente** por
  `(workspace, dedupe_key)`: el mismo toque dos veces queda una sola. Como
  recalcula desde la tabla, un toque viejo que llega tarde (una relectura) queda
  en su lugar y el primero sigue siendo el primero.
- **`recordTouch`** (`lib/contacts/touch.ts`) es lo único que usa el código:
  valida con Zod, recorta `raw` a una lista blanca (**nunca** tokens ni
  secretos) y **nunca lanza**.

### Tres formas conviven, y se lee una sola

`contacts.attribution` tiene hoy la forma **canónica** (la de arriba), la de
**clicks** (`first_click`/`last_click`, del alta manual vieja) y la **plana**
del agendamiento (`utm_*`, `source: 'scheduling'`). `readAttribution`
(`lib/contacts/attribution.ts`) entiende las tres y devuelve siempre la
canónica: nadie más tiene que saber que existieron tres. Las viejas **no se
borran** (la base mezcla con `||`).

## Quién anota un toque

| Qué pasó | Toque | Clave para no duplicar |
|---|---|---|
| El contacto escribe por DM (Instagram, WhatsApp) o por email | **Solo los que suman información** (abajo) | id del mensaje |
| Alguien comenta una publicación | Sí, si es (o pasa a ser) contacto (abajo) | `comment:<id del comentario>` |
| Alta a mano | Sí | `manual:<contacto>` |
| Importación de CSV | Solo a los contactos **nuevos** | `import:<importación>:<contacto>` |
| Reserva desde la página pública o el embed | Sí (lo hace `create_booking`, también para un contacto que ya existía) | `booking:<reserva>` |
| Reserva a mano o por el agente de IA | **No** (Agenda v2, 00129): no hay forma de saber de dónde vino el lead, y un toque inventado `web/booking` pisaría el toque real (el DM o el comentario que lo trajo) | — |
| Los contactos de antes de este bloque | Un toque por su evento de alta, solo donde la atribución estaba vacía (backfill de la 00115) | `event:<evento>` |

### De los mensajes, solo lo que suma

Un contacto activo manda cientos de mensajes y una fila "Instagram · mensaje
directo" por cada uno no dice nada: haría que el "último toque" cambie con cada
"ok". Se registra solo:

1. el **primer** mensaje del contacto,
2. una **respuesta a una historia** (de dónde vino la conversación),
3. un mensaje que trae **datos de un anuncio** (el anuncio es el origen),
4. el que **vuelve después de 7 días** sin escribir.

Lo decide una función pura (`lib/contacts/touch-inbound.ts`). **Anotar el toque
va siempre después de guardar el mensaje y dentro de un `try/catch`:** que no se
pueda anotar de dónde vino no puede ser un error del webhook.

### De los comentarios (F86)

- **Instagram no crea contactos por comentar.** Solo se vincula el comentario si
  la persona ya es contacto, o si la automatización por palabra clave la creó
  (por eso se intenta antes y después de `processComment`, que no se toca).
  Crear un contacto por cada comentarista llenaría el CRM de gente que solo
  opinó y dispararía "contacto nuevo" para cada uno.
- **TikTok sí crea un contacto anónimo** (`Unknown commenter` + su
  `tiktok_username`): no tiene mensajes directos, así que el comentario es la
  única señal que va a haber. Nace anónimo, que el sistema ya sabe ocultar de las
  listas y no cuenta como "contacto nuevo". Si después escribe por otro canal,
  `find_or_link_contact` los unifica.
- Los comentarios propios no crean contacto ni toque.
- El toque lleva `social_post_id` y `content_post_id` cuando la publicación se
  conoce, y por eso después se puede contar por publicación y por pieza.
- YouTube, LinkedIn y Threads **no** vinculan comentarios con contactos.

## Dónde se ve (F88)

- **Ficha del contacto:** el primer y el último toque en una frase que se lee
  sola ("Instagram · comentario · «cómo cobrar en dólares» · 12 sep"); con un solo
  toque se muestra una vez ("Único toque"); el camino completo va plegado. Si el
  toque trae una pieza, su nombre es un link a ella.
- **Panel de la bandeja:** la misma frase.
- **Lista de contactos:** filtros **Fuente** y **Medio** por el **primer** toque
  (`?fuente=` y `?medio=`). La pantalla lo dice: "entraron por un comentario" no
  es "alguna vez comentaron". Los valores vienen de la URL y se validan contra la
  lista cerrada; uno inventado se ignora.

## Atribución en el contenido (F101 a F105)

- **Tablero (F101):** la tarjeta y la fila de la lista muestran cuántos contactos
  tienen a la pieza como **primer toque**, solo si la pieza ya salió (sin
  publicaciones no se muestra ni un cero). El conteo se lee con el cliente de
  quien mira, así que respeta el alcance de leads.
- **Leads por comentario (F104, `lib/dashboards/piece-leads.ts`):** un lead de una
  publicación es un contacto cuyo **primer** toque fue un comentario en esa
  publicación. Reglas:
  - **Primer toque, no cualquiera:** si la persona ya era contacto (llegó por un
    DM el mes pasado), su comentario de hoy no la trajo y no cuenta.
  - **Una persona cuenta una vez por pieza**, aunque haya comentado dos
    publicaciones: se queda con donde llegó primero. Por eso el total de la pieza
    **no** es la suma de las filas.
  - **No se atribuye desde un mensaje directo por palabra clave:** no hay forma
    confiable de saber qué publicación originó un DM, y adivinarlo sería peor que
    no mostrarlo.
  - En una red que no lo mide es un **guion**, no un cero.
  Se ve en la fila de cada red y en el total del drawer de la pieza, y como
  columna **Leads** en la tabla agrupada del dashboard de contenido.

## Lo que esto NO es

- **No es atribución de seguidores.** Ninguna red informa cuántos seguidores
  trajo un post; el "salto de seguidores" de un post es una señal contra lo
  normal de la cuenta y la pantalla lo rotula así (`follower-bump.ts`).
- **No es multi-toque ponderado.** Hay primer y último toque; no un reparto del
  crédito entre todos.
- **No cubre lo que no pasó por el sistema:** una persona que vio un reel y
  escribió semanas después por WhatsApp sin que nada la una a la pieza tiene
  como primer toque el mensaje.

## Verificación

```
node scripts/verify-attribution.mjs   # 39 checks contra la base real
node scripts/verify-scheduling.mjs    # incluye el toque de la reserva
node scripts/verify-crm.mjs
```

`verify-attribution` prueba la lectura cruzada entre negocios y el alcance de
un Member, la idempotencia por `dedupe_key`, primer y último toque con un toque
fuera de orden, que el `source` que leen los triggers sea el de antes para un
contacto viejo, y que `create_booking` escribe la forma canónica. Crea y limpia
sus datos (prefijo `zz-test-`) y no se corre a la vez que otro `verify-*`.

## Extra L: que no se pierda nada, y el vinculo con los anuncios de Meta

Construido en el Extra L (AT1 a AT3). Avance y decisiones: `docs/PROGRESS-atribucion.md` y `docs/PENDIENTE-atribucion.md`.

### Toques nuevos y datos que ya no se pierden (AT1)

- **Agenda** (`create_booking`, 00190): el toque de una reserva ahora lleva `ad_id`, `adset_id`, `campaign_id` y, en `raw`, `utm_id`,
  `placement`, `fbp`, `fbc`, `ga_client_id` y la primera visita. El navegador manda todas las claves de `lib/attribution/keys.ts` (no solo
  cinco UTMs) y completa la cookie `ssa_attr`; el embed de la agenda hereda la atribución guardada (`attr`, solo si hay).
- **Formularios**: ya no inventan un `utm_content` con el nombre del formulario; la ficha lo muestra desde `raw.source_id`.
- **Chat** (`messages.origin_context`, 00189): la mención en una historia, el mensaje que viene de un anuncio (Instagram y clic a WhatsApp) y la
  respuesta a una historia quedan registrados. `story_mention` es un medio nuevo («Mención en historia»). Los flujos pueden filtrar
  «Solo si vino de un anuncio» / «Solo menciones en historias» y leer `{{message_origin.ad_id}}`, `{{message_origin.ad_title}}` y
  `{{message_origin.is_story_mention}}`. Un comentario en un anuncio genera un toque `paid_social` con el id del anuncio.
- **Webhooks**: un toque `origin = webhook` (ver `docs/webhooks.md`).

### El catalogo de Meta (AT2)

`meta_campaigns`, `meta_adsets` y `meta_ads` (00191) guardan nombre, estado efectivo, creativo y la publicacion que promocionan. El sync de
anuncios trae **primero el catalogo** (incluidos pausados, archivados y borrados), independiente de las metricas; un tope de 50 paginas o el
limite de uso de Meta cortan el sync y lo anotan en la cuenta (`last_error`), nunca en silencio. Las miniaturas se copian al bucket privado
`ad-creatives`. Un anuncio que promociona una publicacion de Instagram se enlaza solo con su `social_posts` y su pieza (el enlace manual no se pisa).

### El vinculo de cada toque con su campaña, conjunto y anuncio (AT3)

Cada toque nuevo pasa por el trigger `contact_touches_meta_match` (BEFORE INSERT, **nunca hace fallar el insert**) que llama a
`resolve_meta_match` y deja `meta_campaign_id`, `meta_adset_id`, `meta_ad_id`, `meta_match_status` (`none` · `matched` · `unmatched` · `manual` ·
`ignored`), el metodo y el motivo. El orden: **anuncio** (`ad_id` → `utm_content` igual a un id → `utm_content` como nombre; con varios homonimos se
desempata por la campaña, y si siguen varios NO se vincula) → **conjunto** → **campaña** → coherencia (si el anuncio es de otra campaña, gana el anuncio).

- La funcion SQL tiene una **gemela en TypeScript** (`lib/attribution/meta-match.ts`) y los **mismos casos** (`meta-match.cases.json`) corren contra las dos.
- **Solo cuentan como datos de Meta** los ids y el `fbclid`, y `campaign`/`content_label`/`term` cuando el toque puede traer UTMs de verdad (agenda,
  formulario, webhook, importado, manual) o ya trae un id de anuncio. En un comentario o un DM organico, `content_label` es el titulo de la publicacion.
- Despues de cada sync, `rematch_meta_touches` vuelve a resolver los toques sin vincular de los ultimos 90 dias (si llega el anuncio que faltaba).
  Nunca toca lo `manual` ni lo `ignored`.
- **«Sin vincular»** (`/dashboard/dashboards/ads/sin-vincular`): lista los toques sin vincular con el motivo en palabras; se puede vincular a mano
  (completa conjunto y campaña), ignorar o quitar el vinculo manual. Cada accion queda en el historial del contacto (`attribution.meta_*`).
- **La ficha del contacto** muestra campaña › conjunto › anuncio por nombre, con miniatura, y como se vinculo.
- `contacts.attribution` sigue siendo una copia derivada: `refresh_contact_attribution` la recalcula con el mismo orden que `record_contact_touch`.

### Guia: parametros de URL para los anuncios

Para que un anuncio quede vinculado, la URL de destino tiene que llevar (en el Ads Manager, «Parametros de URL»):

```
utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}
```

`{{campaign.id}}`, `{{ad.id}}` y `{{adset.id}}` los reemplaza Meta por los ids; con ids el vinculo es exacto. Con nombres (`{{campaign.name}}`,
`{{ad.name}}`) tambien funciona, pero un nombre repetido queda ambiguo y va a «Sin vincular».

## La URL de entrada completa (`entry_url`, octubre 2026)

Hasta acá se guardaba solo lo que el vocabulario cerrado reconoce (UTM, ids de clic, ids del anuncio). Lo que el anuncio mandaba y no estaba en la lista (`ad_name`, `campaign_name`, `site_source_name`, un `?ref=podcast` propio) se perdía. Ahora **la dirección completa por la que entró la persona se guarda entera**.

- **Qué se guarda** (`lib/attribution/entry-url.ts`, `entryUrlFrom`): solo `http`/`https`, con todos los parámetros en su orden y su codificación originales. **Se sacan** los que identifican a una persona (`lib/attribution/sensitive-params.ts`: tokens, claves, contraseñas), los internos del sistema (`embed`, `attr`, `preview`, `c`, `referrer`), el `#`, las credenciales y los caracteres de control. Tope de 2000 caracteres (nunca corta un `%` a la mitad).
- **De dónde sale:** de la página de llegada. Si la visita de ahora trae UTM o ids de clic, gana la de esta visita; si no, la de la última visita guardada; si no hay ninguna, la de la página. En un embed, la página que lo contiene manda la URL **entera** dentro de `attr` (su tope subió de 2048 a 4096 bytes) y gana sobre el `referrer`, que llega cortado a 500.
- **Dónde queda:** `form_submissions.attribution.entry_url` (en cada respuesta, ya sanitizada de nuevo en el servidor), `contact_touches.entry_url` (migración 00215; `record_contact_touch` la escribe sin cambiar su firma ni su comportamiento) y, para la Agenda, `bookings.utm.entry_url` (de ahí pasa al toque por `raw.utm`, sin tocar `create_booking`).
- **Dónde se ve:** el detalle de una respuesta ("De dónde vino") y las visitas del contacto, con un bloque monoespaciado que parte líneas y un botón Copiar. El CSV de respuestas **no** suma una columna (queda anotado en PENDIENTE).
- **Lo que NO cambia:** `landing_page` y `page_url` siguen filtradas (solo claves de atribución / sin query); la lista de claves es la de siempre (`lib/attribution/keys.ts`) y `contacts.attribution` sigue siendo una copia derivada que no incluye la URL completa.
- **Nunca se loguea** una URL de entrada: puede traer datos de la campaña que no tienen por qué quedar en los logs.
