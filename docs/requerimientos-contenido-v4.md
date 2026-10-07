# Requerimientos v4 — SSA Business AI OS
## Etapa 2 · Contenido: planificación, estados y guardado automático

**Versión:** 4.0 — 7 de octubre de 2026
**Paso del Método Builder:** 05-Requerimientos (**brownfield**, corrida autónoma one-shot)
**Cliente:** Wendy Mardigian / Scaling Systems Academy

**Anclado a:** `requerimientos-contenido-v3.md` (F73 a F105), `requerimientos-etapa2.md` (v2.0, F1 a F72) y `cambios-prototipo-contenido.md`.

**Referencia visual:** el prototipo **SSA BAIOS Prototipo, versión 23**, publicado como artefacto en `https://claude.ai/artifact/E67iA88ZBsCoQgp7KaP6nF`. **No está en el repo y no hace falta exportarlo.** Claude Code lo lee con su **herramienta de Artifact** (`action: "read"` con esa `url`) — no con WebFetch ni curl. Como pesa unos 730 KB, conviene pedirlo con `path: "index.html"`, que lo guarda en disco, y dejar esa copia en `docs/referencia/prototipo-ssa-baios.html` (en `.gitignore`: es referencia, no código) para usarla durante toda la corrida sin volver a bajarla. Sección a mirar: **Contenido** — kanban, drawer de idea, drawer de pieza, calendario. Si no se puede acceder al artefacto, **hay que parar y pedirlo**, no inventar las pantallas.

> **Donde este documento y el prototipo se contradigan en una regla de negocio, gana este documento; donde se contradigan en cómo se ve o cómo se comporta una pantalla, gana el prototipo.**

> **Jerarquía de documentos.** Este documento **corrige** a la v3 y al plano de la Etapa 2. Donde se contradigan, **gana este**. Es una tanda de correcciones sobre un módulo ya construido y en uso, no una fase nueva.

---

## 1. Mapa de ruta

| Etapa / tanda | Estado | Qué tiene |
|---|---|---|
| Etapa 1 — Sistema operativo base | Construida | CRM, bandeja Instagram + WhatsApp, flows, secuencias, conocimiento, agente IA, dashboards de chat |
| Etapa 2 — Integraciones, publicación y métricas | Construida (F1 a F72) | Integraciones, pipeline de contenido, publicadores, métricas, email, roles |
| Contenido v3 (F73 a F105) | Construida | Cuentas sociales reales, atribución de contactos, modelo nuevo de la pieza, drawer, medición por pieza |
| **Contenido v4 — este documento (C1 a C10)** | **A construir** | Planificación en redes no conectadas, estados por red, guardado automático, limpieza de campos duplicados |
| Etapa 3 — Agentes | Futuro | Agentes con conversaciones propias, generador de piezas |
| Etapa 4 / 5 — Agendamiento y Ventas | Futuro / en curso | Google Calendar, catálogo de productos, pagos |

**Lo que NO se construye ahora pero el diseño contempla:**
- Los agentes de la Etapa 3 van a crear ideas y escribir guiones: la interfaz de generación (`generateCopy`) no cambia de forma.
- El catálogo de productos de la Etapa 5: `content_offers` queda listo para enlazarse con `products`.
- La atribución desde DM por palabra clave: la tabla `contact_touches` ya la contempla, pero sigue fuera de alcance (D3 de la v3).

---

## 2. Cambios en la base de datos y riesgos

> **Esta es la sección que hay que aprobar antes de que se construya nada.**

| N° | Qué hace | Tipo | Riesgo | Reversible |
|---|---|---|---|---|
| 00119 | `social_posts.origin` suma el valor permitido **`manual`** | **Modifica estructura existente** (CHECK) | Bajo | Sí, si no hay filas con ese valor |
| 00120 | Backfill: `networks[].format` toma el valor de `networks[].options.contentType` donde `format` esté vacío | **Modifica datos existentes** | **Medio** | Sí, `format` vuelve a null |
| 00121 | *(escrita, NO se aplica)* Borra `content_posts.material_status`, `content_posts.copy`, `content_ideas.hook/angle/notes` y `networks[].options.contentType` | **Destructiva** | Alto | **IRREVERSIBLE** |

Las columnas nuevas del jsonb (`networks[].auto`, `published_manually_at`, `external_url`) **no necesitan migración**: `networks` ya es `jsonb` y los valores faltantes se leen con default en código.

### Qué se aprueba

- **00119** permite que una publicación subida a mano exista como fila real en `social_posts`. Sin eso, lo que publicás por fuera de la app no entra al calendario ni a las métricas. Es agregar un valor a una lista permitida: no toca ninguna fila existente.
- **00120** copia el formato viejo al campo nuevo, para que las piezas que ya existen sigan publicando en el formato correcto después de unificar los dos campos (C9). **Es la que más atención pide**: si el mapeo sale mal, una pieza que era Reel podría publicarse como post de feed.
- **00121 no se aplica en esta corrida.** Se escribe, se guarda y se anota en `docs/PENDIENTE.md`. Se aplica más adelante, a mano, cuando esté confirmado que nada lee las columnas viejas.

### Orden contra el deploy

**Las migraciones se aplican ANTES de desplegar el código nuevo.** La 00119 es condición para que funcione "Marcar como publicado" y la 00120 para que las piezas existentes publiquen bien. El código viejo sigue funcionando contra la base nueva (las dos son compatibles hacia atrás), así que se pueden aplicar con tranquilidad y por adelantado.

### Qué pasa con los datos que ya existen

| Dato | Qué le pasa |
|---|---|
| Filas de `social_posts` | Ninguna cambia. El CHECK nuevo solo amplía lo permitido. |
| Piezas con `options.contentType` | Su `format` se completa con el equivalente: `reel` → `reel`, `story` → `story`, `carousel` → `carousel`, `feed` → `image` si tiene un archivo, `carousel` si tiene más de uno. |
| Piezas con `format` ya cargado | No se tocan: la 00120 solo completa donde está vacío. |
| `material_status` | Queda con su valor, deja de leerse y de escribirse. No se pierde nada. |
| `copy`, `hook`, `angle`, `notes` | Igual: quedan, dejan de usarse. |

### Cómo se verifica después de aplicar

```
node scripts/verify-content.mjs      # sale 0
node scripts/verify-rls.mjs          # sale 0
npx vitest run                       # sale 0
```
Más una consulta de control después de la 00120: ninguna fila de `content_posts` con una entrada de `networks` que tenga `options.contentType` y `format` vacío.

### Cómo se vuelve atrás

- **00119:** `ALTER TABLE social_posts DROP CONSTRAINT … ADD CONSTRAINT …` con la lista vieja. Solo funciona si antes se borran o reasignan las filas con `origin = 'manual'`.
- **00120:** poner `format` en null donde la pieza tenga `options.contentType`. La definición vieja del CHECK y el SQL de reversa van copiados en el comentario de cada migración.
- **00121:** no aplica (no se ejecuta). Cuando se aplique, es **IRREVERSIBLE**: los datos de esas columnas se pierden.

---

## 3. Objetivo y mapa de bloques

**Objetivo:** que el módulo de contenido sirva para **planificar**, no solo para publicar automáticamente. Wendy tiene que poder armar una pieza para cualquier red —esté conectada o no—, saber de un vistazo qué sale solo y qué tiene que subir a mano, marcar lo que subió, y que todo eso cuente en el calendario y en las métricas. Y que mientras trabaja no tenga que apretar "Guardar" nunca.

**Por qué ahora:** hoy el drawer **bloquea el paso** si no hay ninguna red conectada. De las cinco redes del alcance, solo Instagram y TikTok están conectadas (por Zernio); YouTube, LinkedIn y Threads dependen de trámites externos que pueden tardar meses. Sin esta corrección, el módulo no se puede usar para el 60% de las redes del plan de contenido.

### Bloques de ejecución

| Bloque | Día | Qué se construye | Contexto compartido |
|---|---|---|---|
| **B15** — Planificación sin conexión | 1 | C1, C2, C3 — redes no conectadas, modo de publicación, estado por red, marcar como publicado | `content_posts.networks[]`, `social_posts`, `lib/content/schedule.ts`, drawer de pieza |
| **B16** — Estados y clasificación | 1-2 | C4, C5, C8 — estado de la pieza, fuera estado del material, embudo, dónde se ven los programados | `lib/content/status.ts`, kanban, calendario, Social |
| **B17** — Limpieza de campos duplicados | 2 | C7, C9, C10 — formato único, publicador fuera de la tarjeta, opciones avanzadas | `networks[].format`, publicadores, `lib/content/validation.ts` |
| **B18** — Guardado automático y versiones | 2-3 | C6 — autoguardado y agrupación de versiones por sesión | `content_post_versions`, drawer de idea y de pieza |
| Testing de la tanda | 3 | Suite completa, revisión visual contra el prototipo, documentación | — |

**Por qué este orden:** B15 es el que desbloquea el uso real y el que toca el modelo; si la corrida muere ahí, Wendy ya puede planificar. B17 (unificar formato) es el más riesgoso para la publicación, así que va después de que los estados estén estables y antes del autoguardado, que es puramente de interfaz.

---

## 4. Usuarios y roles

Sin cambios respecto de la v3. Se repiten acá los que tocan este módulo:

| Rol | Puede hacer | No puede hacer |
|---|---|---|
| **Owner** (sistema) | Todo | — |
| **Admin** (sistema) | Todo lo de contenido: crear, aprobar, programar, marcar como publicado, generar con IA, configurar pilares y ofertas | Quitar al último Owner |
| **Member** (sistema) | Ver el tablero, crear ideas y piezas, editar las suyas en Borrador / En producción / En revisión | Aprobar, programar, marcar como publicado, generar con IA, cambiar el estado de la pieza |
| **Content Manager** (rol personalizado, ya existe en producción) | Lo que marquen sus permisos: hoy `content.*`, `social.view` y `dashboards.content.view` | Lo que no marquen |

**Permisos que gobiernan esta tanda:** `content.view`, `content.create`, `content.approve`, `content.publish`, `content.ai`, `settings.manage`. **No se crean permisos nuevos.** "Marcar como publicado" usa `content.publish`.

---

## 5. Alcance específico de esta tanda

### 5.1 Planificación en redes no conectadas

- **Qué hace:** permite agregar cualquiera de las cinco redes a una idea o a una pieza, esté conectada o no, y configurarla completa: formato, archivos, caption, CTA y fecha.
- **Hasta dónde llega:** la red no conectada queda siempre en **fecha tentativa**; nunca se programa sola. Cuando Wendy la sube a mano por fuera de la app, la marca como publicada y entra al calendario, a Social y a las métricas.
- **Qué NO hace:** no publica en redes no conectadas, no intenta detectar sola que la publicaste, no trae métricas de una publicación marcada a mano hasta que la cuenta esté conectada y la sincronización la encuentre.
- **Dónde va lo que queda afuera:** conectar YouTube, LinkedIn y Threads depende de trámites externos y está fuera de alcance desde la v3 (§10).

### 5.2 Modo de publicación y estados por red

- **Qué hace:** cada red de una pieza declara **cómo se publica** (la subo yo / el sistema la publica) y muestra **su propio estado** derivado: Sin fecha, Fecha tentativa, Programado, Publicado, Falló.
- **Hasta dónde llega:** el estado de la pieza se deriva de los de sus redes a partir de Programado. Antes de eso lo elige la persona con un dropdown.
- **Qué NO hace:** no permite elegir a mano los estados derivados, no reemplaza el flujo de aprobación, no cambia el despachador ni los reintentos.

### 5.3 Guardado automático y versiones

- **Qué hace:** todo se guarda solo —dropdowns al elegir, texto al salir del campo, y siempre antes de cerrar el drawer— y las versiones se agrupan por sesión de edición en vez de crear una por cambio.
- **Hasta dónde llega:** el historial sigue mostrando las últimas 50 versiones, con Comparar y Restaurar.
- **Qué NO hace:** no hay edición colaborativa en tiempo real ni bloqueo de registro. Si dos personas editan a la vez, gana el último guardado y se avisa, como hoy.

### 5.4 Limpieza de campos duplicados

- **Qué hace:** unifica "Formato" y "Tipo" en un solo campo, saca el selector de publicador de la tarjeta de red, y repliega las opciones propias de cada red.
- **Qué NO hace:** no cambia el `default_publisher` de la cuenta ni su configuración en Integraciones, no toca los publicadores.

---

## 6. Funcionalidades y criterios de aceptación

> Criterios en formato EARS (`CUANDO …, EL SISTEMA DEBE …`) o DADO/CUANDO/ENTONCES, cada uno con el test que debe pasar. El proyecto testea con **Vitest** (entorno node) y scripts `node scripts/verify-*.mjs`. **No se suman dependencias de testing.** La lógica de pantalla va en funciones puras; los componentes solo las componen.

---

### BLOQUE 15 — Planificación sin conexión

#### C1: Se puede agregar cualquier red, esté conectada o no

**Descripción:** se quita el bloqueo de "Publicación por red". El selector ofrece las cinco redes siempre. Las no conectadas llevan un chip **"a mano"** en el selector y en la cabecera de su tarjeta, y se configuran completas. El estado vacío deja de bloquear y pasa a ser informativo, con link a Integraciones.

**En la idea** el comportamiento es más simple: la idea solo elige **a qué redes apunta**, sin fecha ni formato ni archivos. Puede elegir redes no conectadas. Al aprobarla, esas redes se heredan a la pieza, y es en la pieza donde se define la fecha de cada una.

**Criterios:**
- CUANDO ninguna cuenta está conectada, EL SISTEMA DEBE permitir agregar redes a una idea y a una pieza, elegir formato y archivos, y guardar fechas.
- CUANDO una red no está conectada, su tarjeta DEBE mostrar el chip "a mano" y NO DEBE ofrecer programación automática.
- CUANDO se aprueba una idea con redes no conectadas, la pieza DEBE heredarlas todas.
- El estado vacío NO DEBE impedir ninguna acción de planificación.
- Test: `lib/content/network-card.test.ts` (nuevo) cubre red conectada y no conectada; `lib/content/idea-gallery.test.ts` extendido cubre la herencia.

#### C2: Cada red define cómo se publica

**Descripción:** `networks[]` suma `auto boolean` (default `false`). En la tarjeta de cada red, un bloque **"Cómo se publica en [red]"** con dos opciones excluyentes:

| Opción | Qué significa |
|---|---|
| **La subo yo** (default) | La fecha queda tentativa: entra al calendario, pero no se crea ningún job. |
| **El sistema la publica** | A la fecha se publica sola: crea la fila de `social_posts` y su job (F25, sin cambios). |

La segunda está **deshabilitada, con el motivo a la vista**, cuando la red no tiene cuenta conectada.

**Criterios:**
- CUANDO una red no tiene `social_account` activa, `auto` NO PUEDE ponerse en `true`, ni por la interfaz ni por la Server Action: el servidor lo rechaza.
- CUANDO `auto` pasa a `true` y hay fecha futura, DEBE crearse la fila `scheduled` y su job.
- CUANDO `auto` pasa a `false` y había una fila programada, DEBE quedar `cancelled`, el job cancelado, y la fecha **se conserva** como tentativa.
- CUANDO se desconecta una cuenta, las redes de esa plataforma con `auto = true` DEBEN pasar a `false`, conservar su fecha y avisar.
- Test: `lib/content/schedule.test.ts` extendido, con un caso que llama a la acción salteando el editor.

#### C3: Estado derivado por red y "Marcar como publicado"

**Descripción:** cinco estados por red. Ninguno se elige a dedo: cuatro se derivan y uno se marca con un botón.

| Estado | Cuándo | Cómo se ve |
|---|---|---|
| **Sin fecha** | no hay fecha | gris |
| **Fecha tentativa** | hay fecha y `auto = false` | gris con borde punteado |
| **Programado** | hay fila `scheduled` en `social_posts` | **resaltado**: pastilla llena y barra de color en el borde izquierdo de la tarjeta |
| **Publicado** | la API lo confirmó, **o** se marcó a mano | verde, con la coletilla "a mano" cuando corresponde |
| **Falló** | la publicación falló (F35) | rojo |

**"Programado" tiene que distinguirse de un vistazo de "Fecha tentativa":** es la diferencia entre "esto sale solo" y "esto lo tengo que subir yo", y confundirlos es el error más caro que puede cometer el usuario.

**Acción nueva "Marcar como publicado"** (permiso `content.publish`), en toda red que no esté publicada. Pide fecha (por defecto, ahora) y opcionalmente el link del post. Crea una fila en `social_posts` con `origin = 'manual'`, `status = 'published'`, su `published_at`, su `url` y el `content_post_id` de la pieza. Si después la sincronización encuentra el post real, lo vincula a **esa misma fila** por `(social_account_id, external_post_id)`. Se puede deshacer mientras no tenga métricas.

**Criterios:**
- CUANDO una red no conectada tiene fecha, su estado DEBE ser "Fecha tentativa" y nunca "Programado".
- CUANDO se marca como publicado a mano, DEBE existir una fila `social_posts` con `origin = 'manual'` y la pieza DEBE recalcular su estado.
- CUANDO la sincronización encuentra el post real de una publicación marcada a mano, NO DEBE duplicar la fila.
- CUANDO se deshace el marcado y la fila ya tiene métricas, EL SISTEMA DEBE rechazarlo explicando por qué.
- CUANDO un Member intenta marcar como publicado, DEBE rechazarse (no tiene `content.publish`).
- Test: `lib/content/network-state.test.ts` (nuevo) cubre los cinco estados y las transiciones; `verify-content.mjs` extendido.

**Bloque 15 listo cuando:** C1 a C3 cumplen sus criterios, `npx vitest run` sale 0, `npm run build` compila, `node scripts/verify-rls.mjs` y `node scripts/verify-content.mjs` salen 0, y ningún test previo se rompió.

---

### BLOQUE 16 — Estados de la pieza y clasificación

#### C4: Estado de la pieza como dropdown con color, sin "estado del material"

**Descripción:** tres partes.

**(a)** Se elimina **"Estado del material"** (`pendiente` / `grabado` / `editado` / `listo`) del drawer. Era un segundo eje de estado que se pisaba con el primero. La columna queda en la base sin usar; la migración que la borra se escribe y no se aplica (00121).

> Hoy marcar "Grabado" es lo que mueve la pieza a En producción. Al sacarlo, **ese movimiento lo hace la persona con el dropdown**. No puede quedar ningún camino que dependa del campo viejo.

**(b)** El chip de estado pasa a ser un **dropdown teñido con el color del estado actual** (fondo suave, borde y texto en ese color, más un punto). Los colores son los que ya usa el kanban (`st-*`): no se inventan nuevos.

**(c)** Se separa lo que se elige de lo que se deriva:

| Estado | Cómo se fija |
|---|---|
| Borrador · En producción · En revisión · Aprobado | **Se eligen** en el dropdown |
| Programado · Publicado · Publicado parcial · Falló | **Se derivan** de los estados de las redes (C3). El dropdown los muestra bloqueados, con el tooltip "Lo definen las redes" |

Derivación: todas las redes publicadas → Publicado; alguna publicada y otras no → Publicado parcial; todas fallidas → Falló; alguna programada → Programado. Es la tabla de F17, ahora alimentada también por las publicaciones marcadas a mano.

**Criterios:**
- CUANDO una pieza tiene una red programada, su estado DEBE ser Programado y el dropdown DEBE estar bloqueado.
- CUANDO se marcan a mano todas las redes como publicadas, la pieza DEBE pasar a Publicado sin que nadie toque el dropdown.
- CUANDO un Member abre una pieza, el dropdown DEBE estar bloqueado.
- NO DEBE quedar ninguna referencia a `material_status` en `lib/` ni en `app/`.
- Test: `lib/content/status.test.ts` extendido con la tabla completa, incluidas las publicaciones manuales.

#### C5: Etapas del embudo TOFU, MOFU y BOFU

**Descripción:** `funnel_stage` tiene exactamente tres valores, con etiqueta y descripción bajo el selector. Hoy en producción se ve "Sin etapa": o no se cargaron las opciones o el default quedó nulo.

| Valor | Etiqueta | Descripción |
|---|---|---|
| `tofu` | TOFU · Descubrimiento | Le habla a quien todavía no sabe que tiene el problema. Alcance y gente nueva. |
| `mofu` | MOFU · Consideración | Le habla a quien ya sabe que tiene el problema y compara cómo resolverlo. Prueba y método. |
| `bofu` | BOFU · Decisión | Le habla a quien ya te sigue y está por comprar. Casos, objeciones y oferta. |

Lista fija en código, no configurable. Se puede dejar vacío y agrupa como "Sin etapa".

**Criterios:**
- CUANDO se abre una pieza o una idea, el selector DEBE ofrecer las tres etapas con su descripción.
- CUANDO se aprueba una idea, su etapa DEBE heredarse a la pieza.
- CUANDO se agrupa el dashboard por embudo, las piezas sin etapa DEBEN aparecer en "Sin etapa" y no desaparecer del total.
- Test: `lib/content/classification.test.ts` extendido.

#### C8: Dónde se ven los programados

**Descripción:** que la diferencia entre tentativo y programado se vea fuera del drawer, que es donde se planifica.

- **Calendario:** la leyenda ya distingue tentativa / programado / publicado / falló (F21). Una publicación marcada a mano aparece como **publicada**; una red no conectada con fecha, como **tentativa**, nunca como programada.
- **Tarjeta del kanban:** los íconos de las redes con el estado de cada una, y las programadas resaltadas.
- **Pie del drawer:** resumen "N programadas · N tentativas · N publicadas".
- **Social → Próximas** (F100): lista lo programado y lo tentativo de esa red, distinguiéndolos.

**Criterios:**
- DADA una pieza con una red programada y dos tentativas, ENTONCES el calendario DEBE distinguirlas y el pie DEBE decir "1 programada · 2 tentativas · 0 publicadas".
- CUANDO una publicación marcada a mano cae en el calendario, DEBE verse como publicada.
- Test: `lib/content/calendar.test.ts` y `lib/content/board.test.ts` extendidos.

**Bloque 16 listo cuando:** C4, C5 y C8 cumplen sus criterios, `npx vitest run` sale 0, `npm run build` compila, y ningún test previo se rompió.

---

### BLOQUE 17 — Limpieza de campos duplicados

#### C9: "Formato" y "Tipo" son el mismo campo: queda uno

**Descripción:** hoy la tarjeta de cada red muestra **dos selectores que significan lo mismo**: "Formato en instagram" (Reel, Carrusel, Imagen, Story) y "Tipo" (Feed, Carrusel, Reel, Story). Es una duplicación de la construcción: **Tipo** es `networks[].options.contentType` del plano v2 (§9.5) y **Formato** es `networks[].format` de F93. Se construyó el nuevo y nunca se borró el viejo.

- **Queda `networks[].format`.** Es el único campo de formato y el que manda sobre qué archivos pide la red.
- **Se elimina `options.contentType`** de la interfaz, de los publicadores y de la validación. El valor existente se migra (00120). La clave del jsonb queda sin usar.
- Los publicadores que hoy leen `contentType` (Zernio para Instagram) pasan a leer `format` y a traducirlo a lo que espera el proveedor. **Ese mapeo es lo único que no se puede romper:** es lo que decide si Instagram publica un Reel o un post de feed.
- **El formato NO arranca vacío:** hereda el formato principal de la pieza (D1 de la v3). Se elimina el chip "Usar el sugerido: Reel" — si hay un sugerido, ya tiene que estar elegido.

**Criterios:**
- NO DEBE quedar ninguna referencia a `contentType` en `lib/`, `app/` ni en los tests.
- CUANDO se agrega una red a una pieza, su formato DEBE venir con el formato principal de la pieza ya elegido.
- DADA una pieza vieja con `contentType = 'reel'`, DESPUÉS de la migración su `format` DEBE ser `reel`.
- CUANDO se publica en Instagram con `format = 'reel'`, el publicador DEBE mandar a Zernio **exactamente lo mismo** que mandaba con `contentType = 'reel'`. **Test de caracterización ANTES de tocar.**
- Test: `lib/publishing/zernio.test.ts` sigue en verde **sin cambiar sus aserciones de salida**; `lib/content/network-format.test.ts` extendido.

#### C7: Los archivos se filtran por el formato de cada red

**Descripción:** ya es F93. **Verificar que funciona y que sigue funcionando con redes no conectadas.** Si está completo, no se toca nada más que el test. Al elegir el formato, el selector de archivos ofrece solo los del tipo que ese formato admite: video para Reel/Video/Short, imágenes para Carrusel, PDF para el carrusel de LinkedIn, ninguno para Solo texto. Los carruseles se numeran en orden de selección y se reordenan con ↑ ↓. Una línea de verificación en verde o rojo por red. Al cambiar de formato se descartan los archivos que ya no sirven.

**Criterios:**
- CUANDO la red no está conectada, el filtrado, la numeración y la verificación DEBEN funcionar igual.
- CUANDO el formato pide un carrusel y hay un solo archivo, la verificación DEBE estar en rojo y la red NO DEBE poder programarse.
- Esta validación DEBE correr también en el servidor (F77).
- Test: `lib/content/network-format.test.ts` extendido.

#### C10: "Publicar por" sale de la tarjeta

**Descripción:** el selector "Publicar por" (con opciones "El de la cuenta" / "Zernio") se saca de la tarjeta de cada red. Es el **publicador**: qué servicio hace la publicación. Para Instagram y TikTok solo existe Zernio, así que las dos opciones son la misma. La única red con dos caminos reales es YouTube (Postproxy o la API de Google).

- El publicador se elige **una sola vez, por cuenta, en Integraciones** — donde F13 ya lo pone. Eso no cambia.
- En la tarjeta no hay selector. Cuando la red tiene **más de un publicador disponible**, aparece una línea informativa: "Se publica con Postproxy · *cambiar en Integraciones*". Con uno solo, no aparece nada.
- **Las opciones propias de cada red** (compartir en el feed, permitir comentarios, duetos, stitch, hecho para niños, control de respuestas) **no son el formato** y siguen existiendo: van en un bloque plegado **"Opciones de [red]"**, cerrado por defecto, al final de la tarjeta.

**Criterios:**
- La tarjeta de red NO DEBE tener ningún selector de publicador.
- CUANDO una red tiene un solo publicador disponible, NO DEBE mostrarse ninguna línea de publicador.
- CUANDO YouTube tiene Postproxy y la API oficial disponibles, DEBE verse la línea informativa con el link a Integraciones.
- El publicador que se usa al publicar DEBE seguir siendo el `default_publisher` de la `social_account` (F13).
- Las opciones por red DEBEN seguir guardándose y llegando al publicador igual que hoy.
- Test: `lib/content/network-card.test.ts` extendido; `lib/social/accounts.test.ts` sigue en verde.

**Bloque 17 listo cuando:** C7, C9 y C10 cumplen sus criterios, `npx vitest run` sale 0, `npm run build` compila, `verify-content.mjs` sale 0, y **los tests de los publicadores siguen en verde sin que se hayan cambiado sus aserciones de salida**.

---

### BLOQUE 18 — Guardado automático y versiones

#### C6: Todo se guarda solo, y las versiones se agrupan por sesión

**Descripción:** son dos cosas distintas y no hay que confundirlas: **guardar el dato no es guardar una versión.**

**(a) Guardado del dato: inmediato, siempre.**

| Qué | Cuándo se guarda |
|---|---|
| Dropdown, selector, chip, toggle | al elegir (`change`) |
| Caja de texto, textarea | **al salir del campo** (`blur`), nunca por tecla |
| Lo que esté en foco al cerrar | **antes** de cerrar: al tocar la ✕, al apretar Esc y **al hacer clic fuera del drawer** |

El drawer **nunca** se cierra perdiendo lo escrito. Un indicador en el pie dice "Se guarda solo" y pasa a "Guardado ✓" un segundo y medio después de cada guardado. **Se eliminan los botones "Guardar versión" y "Enviar a revisión"**: el cambio de estado se hace con el dropdown de C4.

**(b) Versiones: una por sesión de edición, no una por cambio.**

Con autoguardado, la regla vieja de F22 generaría decenas de versiones en una tarde y el tope de 50 se llenaría en días.

- El **primer** cambio después de **10 minutos** sin editar esa pieza crea una versión nueva con `reason = 'edit'`.
- Cada cambio siguiente dentro de la misma sesión **actualiza esa misma fila** (reemplaza su `snapshot` y su `updated_at`). No inserta otra, no borra ni combina nada.
- La sesión se cierra por **10 minutos de inactividad** o al cerrar el drawer.
- **La sesión es por autor:** si otra persona edita, su primer cambio abre su propia versión aunque hayan pasado dos minutos. Si no, el historial le atribuiría a una lo que escribió la otra.

**Cuatro eventos siempre cortan la sesión y se llevan su propia versión**, con su motivo: **cambiar el estado**, **generar con IA**, **restaurar** y **aprobar**.

Implementación: **no hace falta tocar el esquema.** Al guardar, si la última versión de esa pieza tiene el mismo `author_id`, `reason = 'edit'` y menos de 10 minutos, se hace `UPDATE`; si no, `INSERT`. El límite de 50 y el recorte no cambian.

**Criterios:**
- CUANDO se escribe en un campo y se hace clic fuera del drawer, EL SISTEMA DEBE guardar y después cerrar.
- CUANDO se aprieta Esc con un campo en foco, DEBE guardarse antes de cerrar.
- DADA una pieza editada 12 veces en 8 minutos por la misma persona, ENTONCES DEBE existir **una sola** versión, con el contenido final.
- DADA una edición, 15 minutos de pausa y otra edición, ENTONCES DEBEN existir **dos** versiones.
- DADAS dos personas editando con 2 minutos de diferencia, ENTONCES DEBEN existir **dos** versiones, una por autor.
- CUANDO se cambia el estado en medio de una sesión, DEBE crearse una versión aparte con `reason = 'status_change'` y la sesión siguiente DEBE empezar de cero.
- EL SISTEMA NO DEBE escribir en la base por cada tecla.
- Los botones "Guardar versión" y "Enviar a revisión" NO DEBEN existir en ninguna pantalla.
- Test: `lib/content/autosave.test.ts` (nuevo) y `lib/content/versions.test.ts` extendido con los cinco casos, usando un reloj simulado.

**Bloque 18 listo cuando:** C6 cumple sus criterios, `npx vitest run` sale 0, `npm run build` compila, y ningún test previo se rompió.

---

### Definición de "listo" de la tanda

`docs/PROGRESS-CV4.md` con los 4 bloques y C1 a C10 marcados; `npx vitest run`, `npm run build`, `node scripts/verify-rls.mjs` y `node scripts/verify-content.mjs` salen 0; `npm run lint` sin errores nuevos respecto del punto de partida; **ningún test que pasaba en el punto de partida se rompió**; `docs/contenido.md` actualizado con la regla de versiones de C6; la migración 00121 escrita, sin aplicar y anotada en `docs/PENDIENTE.md`; y solo entonces, la rama mergeada a `main`.

### Funcionalidades de etapas siguientes (no se construyen ahora)

- Agente de redacción y generador de piezas — Etapa 3.
- Atribución desde DM por palabra clave a una publicación — fuera de alcance (D3 de la v3).
- Métricas de una publicación marcada a mano antes de conectar la cuenta — depende de la conexión.
- Enlace de `content_offers` con el catálogo de `products` — Etapa 5.

---

## 7. Flujos principales

### Flujo A — Planificar una pieza para una red sin conectar

1. Wendy abre una idea en el kanban y toca **✦ Aprobar y producir copy**. La IA escribe el guion y los captions; se abre la pieza.
2. En **Publicación por red** agrega **YouTube**. La red aparece con el chip **"a mano"**.
3. Elige el formato (hereda el principal de la pieza: Video), y el selector de archivos le ofrece solo los videos de la biblioteca. Elige uno. La línea de verificación se pone verde: "Publica reel-dia1-dia10.mp4".
4. Escribe la fecha: **jueves 15 oct · 10:00**. El estado de esa red pasa a **Fecha tentativa**.
5. En "Cómo se publica en YouTube", la opción *El sistema la publica* está deshabilitada con el motivo: "Conectá la cuenta en Integraciones para programar".
6. La fecha aparece en el calendario con borde punteado. El pie del drawer dice "0 programadas · 1 tentativa · 0 publicadas".

**Resultado:** la pieza queda planificada sin que la cuenta esté conectada.
**Caso de error:** si no hay ningún video en la biblioteca, la verificación queda en rojo ("Falta el archivo: este formato pide 1") y la red no se puede dar por lista.

### Flujo B — Subirla a mano y marcarla

1. El jueves 15 Wendy sube el video a YouTube desde su celular.
2. Abre la pieza y toca **"Marcar como publicado"** en la tarjeta de YouTube. Carga la fecha y pega el link.
3. El sistema crea la fila en `social_posts` con `origin = 'manual'`. El estado de la red pasa a **Publicado a mano**.
4. La pieza recalcula su estado: si Instagram ya estaba publicada, pasa a **Publicado**; si sigue programada, a **Publicado parcial**.
5. La publicación aparece en el calendario como publicada, en Social y en el rendimiento de la pieza.

**Resultado:** lo que se publicó por fuera de la app cuenta igual.
**Caso de error:** si se intenta deshacer el marcado cuando la fila ya tiene métricas, se rechaza con el motivo.

### Flujo C — Programar de verdad en una red conectada

1. En la tarjeta de Instagram, Wendy elige **El sistema la publica**.
2. El servidor valida: cuenta conectada, archivos completos para el formato, fecha futura, tope diario no alcanzado.
3. Se crea la fila `scheduled` y su job. El estado pasa a **Programado**, con la tarjeta resaltada y la barra azul.
4. El estado de la pieza pasa a **Programado** y su dropdown se bloquea.
5. A la hora, el despachador publica. El webhook confirma y la fila pasa a `published`.

**Caso de error:** si la validación del servidor rechaza (archivos incompletos, tope diario), se muestra el motivo y la red queda tentativa.

### Flujo D — Una tarde de edición

1. Wendy abre la pieza a las 14:00 y edita el guion. Sale del campo: se guarda, aparece "Guardado ✓" y **se crea la versión 7**.
2. Entre las 14:01 y las 14:25 cambia el pilar, la oferta, dos captions y agrega una red. Cada cambio se guarda al instante y **actualiza la versión 7**: no se crea ninguna más.
3. A las 14:30 cambia el estado a **En revisión**: se crea la **versión 8** con motivo "cambio de estado", y la sesión se cierra.
4. A las 17:00 vuelve y corrige un caption: se crea la **versión 9**.

**Resultado:** tres entradas legibles en el historial en vez de treinta.

---

## 8. Modelo de datos

### 8.1 Cambios sobre tablas existentes

| Entidad | Campo | Tipo | Requerido | Descripción |
|---|---|---|---|---|
| `content_posts.networks[]` | `auto` | boolean | No (default `false`) | Si esa red se publica sola. Solo puede ser `true` con cuenta conectada |
| `content_posts.networks[]` | `published_manually_at` | timestamptz | No | Cuándo se marcó como publicada a mano |
| `content_posts.networks[]` | `external_url` | text | No | El link del post, cargado a mano |
| `content_posts.networks[]` | `format` | text | Sí (hereda el de la pieza) | **El único campo de formato.** Reemplaza a `options.contentType` |
| `content_posts.networks[]` | `options.contentType` | — | — | **Deja de usarse.** Su valor se migra a `format` (00120) |
| `content_posts` | `material_status` | — | — | **Deja de usarse.** Queda en la base sin leerse |
| `social_posts` | `origin` | text | Sí | El CHECK suma `manual` (00119). Valores: `system`, `external`, `manual` |
| `content_post_versions` | — | — | — | **Sin cambios de esquema.** La agrupación por sesión es una regla de escritura |

### 8.2 Notas de optimización

- **No se crea ninguna tabla nueva.** Todo lo de esta tanda vive en columnas jsonb que ya existen o en un valor más de un CHECK.
- **No se agregan columnas a `content_post_versions`** para la sesión de edición: la regla se resuelve consultando la última versión (`author_id`, `reason`, `created_at`), que ya están indexados por `(post_id, version_no)`.
- `networks[].auto` se lee con default `false` cuando falta, así que las piezas existentes no necesitan backfill.
- Las columnas viejas (`copy`, `hook`, `angle`, `notes`, `material_status`, `contentType`) **se conservan**: la regla del proyecto es que lo destructivo se escribe y no se aplica.

### 8.3 Políticas de datos

| Política | Definición |
|---|---|
| **Soft delete** | `content_ideas`, `content_posts`, `social_posts` y comentarios con `deleted_at`. Sin cambios |
| **Auditoría** | `logAudit` en: marcar como publicado, deshacer el marcado, cambiar el modo de publicación de una red, cambiar el estado de la pieza. Los cambios de texto por autoguardado **no** van al audit log: para eso está el historial de versiones |
| **Snapshot** | `content_post_versions.snapshot` guarda título, formato, guion, caption, networks y media. Suma `auto` y `format` por red |
| **Zona horaria** | La del workspace (Costa Rica, GMT-6) para fechas, calendario y cortes diarios. Todo se guarda en UTC |

---

## 9. Arquitectura

Sin cambios estructurales. Lo que esta tanda toca:

```
[Drawer de pieza]  ── autoguardado (change / blur / antes de cerrar)
   │                     └─► Server Action ─► content_posts
   │                           └─► lib/content/versions.ts ─► sesión de edición (UPDATE o INSERT)
   │
   ├─ tarjeta por red ─► networks[].auto
   │     ├─ auto=true  ─► canScheduleNetwork (valida cuenta + archivos + tope) ─► social_posts(scheduled) + job
   │     ├─ auto=false ─► solo planned_at: nada en la cola
   │     └─ "Marcar como publicado" ─► social_posts(origin='manual', published='published')
   │
   └─ estado de la pieza ─► derivado de los estados por red (lib/content/status.ts)

[Sincronización de métricas] ─► si encuentra el post real de una fila 'manual', la completa (no duplica)
[Calendario · Kanban · Social] ─► leen el estado derivado por red
```

**Lo que no se toca:** publicadores, despachador, reintentos, webhooks de estado, recepción de mensajes y comentarios, agente, flows, secuencias, atribución.

---

## 10. Stack y decisiones técnicas

| Componente | Tecnología | Justificación |
|---|---|---|
| Frontend | Next.js 16 (App Router) + React 19 + Tailwind 4 | El del proyecto. No cambia |
| Validación | Zod 4 en servidor | El del proyecto. Se suma la validación de `networks[].auto` y `format` |
| Base de datos | Supabase (Postgres) con RLS | El del proyecto |
| Tests | **Vitest 3** (entorno node) + `scripts/verify-*.mjs` | **Las que el repo ya tiene. No se suman dependencias de testing** |
| Revisión visual | El navegador de Claude Code contra la copia local del prototipo, bajada del artefacto | Sin Playwright ni Cypress, y sin que nadie tenga que exportar nada a mano |

| Decisión | Elección | Por qué |
|---|---|---|
| Publicación manual | Fila real en `social_posts` con `origin = 'manual'` | Un flag cosmético no entraría al calendario, a Social ni a las métricas. Con una fila real, planificar y medir siguen siendo lo mismo |
| Modo de publicación | `auto` por red, no por pieza | Una pieza puede salir sola en Instagram y a mano en LinkedIn |
| Estado por red | Derivado, no elegido | Si se pudiera elegir, el estado mentiría respecto de la cola real |
| Versiones | Agrupación por sesión con `UPDATE` | No toca el esquema, no pierde nada y deja el historial legible |
| Formato | `networks[].format`, se borra `contentType` | Dos campos para lo mismo generan el bug de publicar en el formato equivocado |
| Publicador | Propiedad de la cuenta, no de la pieza | Una sola decisión, en un solo lugar |
| Referencia visual | El artefacto publicado, leído con la herramienta de Artifact | El prototipo cambia seguido; bajarlo en el momento evita trabajar contra una copia vieja del repo |

---

## 11. Pantallas

### 11.1 Convenciones globales

Las de la Etapa 2 (§13 del plano v2) y la v3, sin cambios: barra superior de 56 px con los filtros y acciones de la página; estados estándar (skeleton, vacío con acción, error con reintentar, toast de éxito); 390 px sin scroll horizontal de página; textos en español rioplatense, voseo, sin jerga; foco visible y Esc en drawers.

### 11.2 Drawer de la pieza (Bloques 15 a 18)

- **Propósito:** editar y planificar una pieza completa, sin salir del tablero.
- **URL:** `/dashboard/content?piece=<id>` (las rutas viejas redirigen, F99).
- **Layout:** drawer de ~900 px sobre el tablero. Cabecera, cuerpo con scroll, pie fijo. A 390 px ocupa la pantalla completa y la vista previa pasa debajo.
- **Cabecera:** título editable · **dropdown de estado teñido con el color del estado** · botón de historial con el número de versiones · ✕.
- **Cuerpo, en orden:** contenido/guion → notas de grabación (ancho completo) → clasificación (formato, embudo, oferta, pilar, referencia) → biblioteca de archivos → caption base → **una tarjeta por red** → selector para agregar una red → estado por red y rendimiento (si está publicada).
- **Tarjeta de red:** cabecera con el ícono, el nombre, el chip "a mano" si no está conectada, el conteo de archivos y **la pastilla de estado**; cuerpo con formato y fecha, selector de archivos filtrado, línea de verificación, caption (base o propio), CTA y palabra clave, bloque "Cómo se publica", botón "Marcar como publicado", y al final el bloque plegado "Opciones de [red]". Borde izquierdo de color según el estado.
- **Pie:** chip del embudo · resumen "N programadas · N tentativas · N publicadas" · indicador "Se guarda solo" · ✦ Generar con IA · Archivar. **Sin "Guardar versión" ni "Enviar a revisión".**
- **Estados:** sin redes → texto que invita a agregar una, sin bloquear; sin archivos → la verificación en rojo; generando con IA → spinner que ocupa el cuerpo.
- **Reglas:** todo editable al abrir, sin modo lectura. Un Member no ve el dropdown de estado habilitado, ni "Marcar como publicado", ni "✦ Generar".

### 11.3 Drawer de la idea (Bloque 15)

- **Propósito:** revisar y decidir una idea, con el texto completo a la vista.
- **Layout:** drawer de ~560 px. Galería: contador "1 de 3" y flechas.
- **Cuerpo:** título · idea/contenido (textarea grande) · formato, pilar, oferta, embudo · referencia · **Redes** (multi-select, con las no conectadas marcadas "a mano") · autoría · nota de qué pasa al aprobar.
- **La idea NO tiene fechas.** Solo elige a qué redes apunta. La fecha de cada red se define en la pieza, después de aprobar.
- **Pie:** Descartar · Aprobar · ✦ Aprobar y producir copy. Descartar y Aprobar traen la idea siguiente; "Aprobar y producir copy" abre la pieza generada.

### 11.4 Kanban, calendario y Social (Bloque 16)

- **Kanban:** la tarjeta de idea solo abre (sin botones de aprobar). La de pieza muestra los íconos de las redes con su estado, y resalta las programadas.
- **Calendario:** una tarjeta por pieza por día; borde punteado para tentativa, lleno para programado, verde para publicado, rojo para fallido; ↻ para redistribución.
- **Social → Próximas:** lo programado y lo tentativo de esa red, al principio de la grilla, distinguidos entre sí.

---

## 12. Guías de UI

Las del fork (Tailwind 4, `components/ui`) y el prototipo. Colores de estado: los que ya usa el kanban (`st-draft`, `st-review`, `st-approved`, `st-scheduled`, `st-published`, `st-partial`, `st-failed`) — **no se inventan colores nuevos**. Íconos de marca con `@icons-pack/react-simple-icons`. Tono: directo, sin jerga, en voseo. Cada campo con una línea de ayuda que explique **qué decide**, no qué es.

---

## 13. Fuera del alcance de esta tanda

### Lo que queda para más adelante en la Etapa 2

| Funcionalidad | Nota |
|---|---|
| Conectar YouTube, LinkedIn y Threads | Trámites externos. Esta tanda justamente permite trabajar sin eso |
| LinkedIn con imagen, video o PDF | Hoy publica solo texto. Son tres flujos de subida distintos |
| Historias de Instagram en Social | Dependen del token de system user de Meta |
| Métricas de una publicación marcada a mano | Llegan recién cuando la cuenta se conecta y la sincronización la encuentra |

### Lo que queda para etapas futuras

| Funcionalidad | Etapa |
|---|---|
| Agente de redacción, generador de piezas, carruseles HTML→PNG | 3 |
| Enlace de ofertas con el catálogo de productos | 5 |

### Lo que queda fuera del proyecto

| Funcionalidad | Motivo |
|---|---|
| Edición colaborativa en tiempo real | Desproporcionado para un equipo de 3 personas. Gana el último guardado, con aviso |
| Detectar solo que publicaste a mano | Ninguna API lo permite sin la cuenta conectada |
| Arrastrar para reordenar los archivos de un carrusel | Se resuelve con ↑ ↓, que además funciona con teclado (D4 de la v3) |
| Atribución desde DM por palabra clave | No hay forma confiable de saber qué publicación originó un DM (D3 de la v3) |

---

## 14. Decisiones transversales

| Decisión | Definición para esta tanda |
|---|---|
| Historial y auditoría | Audit log en las acciones de estado y publicación; las ediciones de texto van al historial de versiones, no al audit log |
| Soft delete | Sin cambios: `deleted_at` en ideas, piezas, publicaciones y comentarios |
| Estados y ciclo de vida | **Dos ejes**: la pieza (manual hasta Aprobado, derivado después) y cada red (siempre derivado). Se elimina el tercero (estado del material) |
| Casos borde | Cerrar la ventana a mitad de una edición: lo último que salió de foco está guardado. Dos personas editando: gana el último guardado, con aviso, y cada una tiene su versión. Desconectar una cuenta con redes programadas: pasan a tentativas y se avisa |
| Zona horaria e idioma | Workspace en Costa Rica (GMT-6); todo se guarda en UTC. Español rioplatense |
| Modelo de asignación | Sin cambios: la pieza tiene autor (`created_by`) y aprobador (`approved_by`) |
| Motor de automatización | Sin cambios: las palabras clave siguen siendo del flow builder; el contenido solo las lee y completa sus `postIds` al publicar |
| Contacto cross-canal | Sin cambios |
| BYOK | Sin cambios: la generación con IA usa el proveedor del workspace y respeta sus topes |
| Patrón de webhooks | Sin cambios: firma verificada, ack inmediato, idempotencia. La sincronización ahora además adopta las filas `manual` en vez de duplicarlas |
| Precios variables / snapshot de precios | No aplica a este módulo |

---

## 14b. Seguridad

| Área | Definición para esta tanda |
|---|---|
| Autenticación | Sin cambios |
| **RLS** | Sin tablas nuevas. `social_posts` sigue siendo **solo escritura del servidor**: la fila `manual` la crea una Server Action con permiso, nunca el cliente |
| **Validación** | Zod en el servidor para `networks[].auto`, `format`, `files[]` y la fecha. **La validación por red se repite en el servidor** (F77): la del navegador no alcanza |
| **Permisos** | `content.publish` gobierna programar, desprogramar y marcar como publicado. `content.approve`, el dropdown de estado. `content.ai`, la generación. Todo verificado en la Server Action, no solo en la interfaz |
| Protección de API | Sin cambios: Server Actions con sesión y permiso |
| Datos sensibles | Sin cambios. El `external_url` que se carga a mano es un link público: no es dato sensible |
| Protección contra ataques | Sin cambios |
| Comunicaciones | Sin cambios |

### Checklist de seguridad para la IA constructora

- [ ] RLS habilitado en todas las tablas (no se crean tablas nuevas; verificar que nada cambió)
- [ ] `social_posts` sigue sin permitir INSERT desde el cliente
- [ ] Guard de permiso en cada Server Action nueva o modificada (`content.publish`, `content.approve`)
- [ ] Validación por red en el **servidor**, no solo en el navegador
- [ ] `auto = true` rechazado en el servidor cuando no hay cuenta conectada
- [ ] Zod sobre `networks[]` antes de escribir el jsonb
- [ ] Secrets en variables de entorno / Vault, nunca en código ni en logs
- [ ] Logs sin datos sensibles

---

## 14c. Base técnica heredada

El proyecto es un fork de **ZernFlow** (MIT) ya muy extendido. Lo que esta tanda necesita saber:

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind 4, Zod 4, Vercel AI SDK v6, `@supabase/ssr` 0.8, `@zernio/node` 0.2.x.
- **Tests:** Vitest 3 (entorno node), ~373 archivos y ~4.486 tests al 3/10/2026. Scripts `scripts/verify-*.mjs` contra la base.
- **Patrones a respetar:** Server Components por defecto; mutaciones en Server Actions (`lib/actions/*`); webhooks en `app/api/webhooks/*`; crons disparados por `pg_cron` vía `private.call_app_cron`; cola de trabajos en `scheduled_jobs` con registro de handlers; auditoría en `lib/audit.ts`; notificaciones con `createNotificationOnce`; `lib/types/database.ts` **se edita a mano** (no hay generador).
- **Migraciones:** numeradas y aplicadas en orden. **La última aplicada se confirma con `list_migrations` en la exploración, no con lo que diga el `CLAUDE.md`** (que al 3/10 estaba desactualizado).

---

## 15. Requerimiento de cambio sobre lo ya construido (brownfield)

### 15.1 Estado actual (as-is)

Construido en la corrida de la v3 (F73 a F105) y en uso en producción:

- El **drawer de la pieza** reemplazó a la página de editor y al detalle. Tiene guion, notas, clasificación, biblioteca de archivos, caption base y una tarjeta por red.
- La **tarjeta de red** tiene hoy: fecha, **"Publicar por"** (selector de publicador), caption, **"Formato en [red]"**, CTA, palabra clave y **"Tipo"**. Los dos últimos son el mismo dato duplicado.
- El **estado de la pieza** es un chip; el **estado del material** es un selector aparte, y marcar "Grabado" mueve la pieza a En producción.
- El pie tiene **"Guardar versión"** y **"Enviar a revisión"**.
- **"Publicación por red" bloquea** cuando no hay ninguna cuenta conectada: "Conectá una en Integraciones para poder programar".
- La **etapa del embudo** existe pero se muestra "Sin etapa".
- `social_accounts` tiene cuentas reales de Instagram y TikTok desde el B10. YouTube, LinkedIn y Threads, sin conectar.

### 15.2 Qué cambia y qué NO cambia

**Cambia:** lo listado en C1 a C10.

**NO cambia (intocable):**
- Los publicadores, el despachador, los reintentos y los webhooks de estado (F30 a F35). Lo único que cambia adentro es **de dónde leen el formato** (C9).
- La recepción de mensajes y comentarios, el agente IA y su runner, los borradores, los flows y su editor, las secuencias, la base de conocimiento, el dashboard de Chat.
- La atribución del B11 y las tablas `contact_touches`, `content_pillars`, `content_offers`.
- La biblioteca de archivos (F92) y la subida (F18).
- El `default_publisher` de la cuenta y su selector en Integraciones (F13).
- El límite de 50 versiones, Comparar y Restaurar (F22).
- `find_or_link_contact`, `channels.platform`, `channels.provider`, las funciones `can_see_*` y el scope de leads.
- El índice y el rendimiento de la pieza (F102 a F104), salvo que ahora también cuentan las publicaciones marcadas a mano.
- Los 7 estados del pipeline, el kanban de 7 columnas y el calendario por pieza.

### 15.3 Análisis de impacto

| Zona que se toca | Quién depende | Riesgo | Mitigación (test de caracterización ANTES) |
|---|---|---|---|
| **Mapeo de formato → payload del publicador** (C9) | Zernio para Instagram y TikTok | **El más caro: que Instagram publique un post de feed donde iba un Reel** | `lib/publishing/zernio.test.ts` ya existe: fija la salida actual **antes** de tocar, y sus aserciones **no se cambian** |
| `canScheduleNetwork` (C2) | Programar desde el editor y desde la acción | Que programar deje de funcionar en las redes conectadas | `lib/content/schedule.test.ts` existente en verde antes y después |
| Derivación del estado de la pieza (C4) | Kanban, calendario, dashboards, notificaciones | Que una pieza publicada vuelva a Borrador, o que el dropdown deje cambiar un estado derivado | `lib/content/status.test.ts` existente fija la tabla de F17 antes de sumarle las manuales |
| `material_status` (C4) | El paso a En producción | Que quede un camino muerto y una pieza no pueda avanzar | Buscar todas sus referencias antes de borrar la interfaz; test que recorre Borrador → En producción con el dropdown |
| Escritura de versiones (C6) | Historial, Comparar, Restaurar, recorte a 50 | Que el autoguardado cree una versión por tecla, o que la agrupación pise la versión de otra persona | `lib/content/versions.test.ts` existente en verde; los casos nuevos con reloj simulado |
| `social_posts` con `origin = 'manual'` (C3) | Sincronización de métricas, calendario, Social, rendimiento | Que la sincronización las duplique o las ignore | Test que corre la sincronización contra una fila `manual` y verifica que la completa en vez de crear otra |

### 15.4 Migraciones sobre datos existentes

Las tres de la sección 2. La **00120** es la única que toca datos: completa `networks[].format` desde `options.contentType` donde esté vacío, con el mapeo de C9. Es idempotente (solo completa lo vacío) y reversible. La **00121** es destructiva y **no se aplica**.

### 15.5 Compatibilidad y transición

El código nuevo funciona contra la base vieja y el viejo contra la nueva: las dos migraciones aplicadas son compatibles en los dos sentidos. **No hace falta feature flag ni despliegue gradual.** Durante la transición, una pieza que todavía no pasó por el código nuevo se lee con `auto = false` por default, o sea, todo queda tentativo hasta que alguien lo programe — que es el comportamiento seguro.

### 15.6 Criterios de no-regresión

- `npx vitest run` completo sale 0: **todos** los tests, no solo los nuevos.
- `npm run build` compila. `npm run lint` sin errores nuevos respecto del punto de partida.
- `node scripts/verify-rls.mjs`, `verify-content.mjs`, `verify-crm.mjs` y `verify-inbox-filters.mjs` salen 0.
- DADO el flujo de publicación actual en Instagram, CUANDO se unifica el formato (C9), ENTONCES `lib/publishing/zernio.test.ts` sigue pasando **sin que se hayan modificado sus aserciones de salida**.
- DADO el historial de una pieza existente, CUANDO se activa el autoguardado (C6), ENTONCES sus versiones previas siguen viéndose, comparándose y restaurándose.
- DADO el estado de una pieza ya publicada, CUANDO se despliega C4, ENTONCES sigue en Publicado y su dropdown está bloqueado.
- Si una zona a tocar no tiene test, **Claude Code lo escribe antes de cambiar** (test de caracterización del comportamiento actual) y tiene que seguir pasando después.

### 15.7 Definición de "listo" del cambio

C1 a C10 cumplen sus criterios; **toda** la suite sale 0 (nuevos + existentes); el build compila; el lint no suma errores; ninguna de las cosas listadas en "NO cambia" se rompió; el drawer recorrido a 1440 y 390 px contra el prototipo (la copia local bajada del artefacto) **sin diferencias visibles**; la 00121 escrita, sin aplicar y anotada en `docs/PENDIENTE.md`.

---

## 16. Verificación en vivo (después del merge, con Wendy)

No forma parte de la definición de listo. Necesita cuentas reales y una persona.

1. Crear una pieza y agregarle **YouTube** (sin conectar). Confirmar que se puede configurar completa y que la fecha aparece en el calendario como tentativa.
2. Subir ese video a YouTube a mano y **marcarlo como publicado**. Confirmar que entra al calendario como publicado, aparece en Social y suma en el rendimiento de la pieza.
3. Programar una pieza real en **Instagram** y confirmar que se publica sola a la hora, con el **formato correcto** (es lo que verifica C9 en vivo).
4. Editar una pieza durante media hora y revisar el historial: tiene que haber **pocas entradas legibles**, no una por cambio.
5. Cambiar el estado con el dropdown y confirmar que el color acompaña y que se creó una versión con ese motivo.
6. Recorrer todo con el rol **Content Manager** para confirmar los permisos.
7. Con todo estable, decidir si se aplica la **00121**.

---

## 17. Si algo bloquea

- **No se puede acceder al artefacto del prototipo:** **parar y pedirlo**, no planificar las pantallas a ciegas ni inventarlas.
- **Un test de caracterización muestra un comportamiento distinto al descrito acá:** gana el comportamiento actual. Se ajusta el documento y se anota.
- **El mapeo de `contentType` a `format` no es unívoco en algún caso:** se resuelve por la cantidad de archivos, y si sigue sin resolverse, esa pieza queda con `format` null y se anota en PENDIENTE para revisarla a mano. **Nunca se adivina un formato al publicar.**
- **Una migración necesita borrar o pisar datos:** se escribe, no se aplica, se anota.
- **Un bloque es más grande de lo que parece:** se puede partir sin cambiar el orden, y se anota en PROGRESS.
- Nunca quedarse en un loop: después de un intento serio, anotar y seguir.

---

## 18. Notas y pendientes

- **Chequeo de sincronía con el alcance:** `alcance-v4.md` (Etapa 2) no contempla la publicación manual ni la planificación en redes no conectadas — asumía que todo se publicaba por el sistema. Esta tanda lo cambia. Conviene actualizar el alcance para que lo refleje; si no, queda la divergencia anotada acá.
- **Lo que hace falta de Wendy antes de construir:** nada. No se necesitan claves ni accesos nuevos, y **no hay que exportar el prototipo**: Claude Code lo baja solo del artefacto. Las dos migraciones que se aplican son de bajo y medio riesgo y la aprobación de la sección 2 alcanza.
- **Supuesto a confirmar en la exploración:** que `lib/publishing/zernio.ts` es el único lugar que lee `options.contentType`. Si hay otro, entra al alcance de C9.
- **El prototipo es un artefacto vivo:** si se le hacen más cambios, la versión sube y Claude Code baja la última al arrancar. Por eso la copia local va en `.gitignore` y no se commitea: la fuente de verdad es el artefacto, no el repo.
