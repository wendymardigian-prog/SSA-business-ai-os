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
| Reserva desde la página de agenda | Sí (lo hace `create_booking`, también para un contacto que ya existía) | `booking:<reserva>` |
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
