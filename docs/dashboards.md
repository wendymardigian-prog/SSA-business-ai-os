# Dashboards

Hay cuatro, y se cambia entre ellos con el selector de la barra superior:

| Dashboard | Qué contesta | Quién lo ve |
|---|---|---|
| **Chat** | Cuánto se responde, qué tan rápido y quién. | Todos, con su alcance de leads |
| **Contenido orgánico** | Cómo rinde lo que se publica. | Owner/Admin, o `dashboards.content.view` |
| **Anuncios** | Gasto, clics y leads de Meta Ads. | Owner/Admin, o `dashboards.ads.view` |
| **Unificado** | Lo orgánico y lo pago del mismo período, lado a lado. | Owner/Admin |

Tres reglas valen para los cuatro:

1. **Un hueco se dibuja como hueco.** Un día sin dato no aparece como cero: el
   gráfico corta la línea. Un cero dice "ese día no pasó nada", que es una
   afirmación distinta de "ese día no sabemos".
2. **Cada cifra se calcula sobre los totales del período**, no promediando
   los diarios. El costo por clic del mes es el gasto del mes sobre los clics
   del mes; un día con dos clics y mucho gasto arrastraría el promedio.
3. **Una división por cero es una raya, no un cero.** Sin clics no hay costo
   por clic. "CPC: $0" se lee como que los clics salen gratis.

Los gráficos son SVG escrito a mano, sin librería: sumar medio mega de
JavaScript por cuatro tarjetas no se justifica.

---

## Chat (Fase 3, Bloque 3)

Métricas de la operación de chat. Todo se calcula con funciones SQL
`SECURITY INVOKER` (migración 00078): se llaman con el cliente del usuario, así
la RLS aplica el scope de leads sin lógica extra en la app. Un Member ve solo
sus conversaciones; Owner y Admin, todo el workspace.

## Funciones

| Función | Qué devuelve |
|---|---|
| `chat_episodes(ws, channel)` | Un episodio por (conversación, tramo). Un episodio arranca con un entrante que es el primero o viene tras una inactividad mayor que `close_after_inactive_hours`. Da `first_inbound_at`, `first_outbound_at`, `first_outbound_origin`. |
| `chat_dashboard_numbers(ws, from, to, channel, author)` | Conversaciones nuevas, recibidos, enviados (filtrados por autor), mediana de primera respuesta. |
| `chat_waiting_now(ws, channel)` | Conversaciones abiertas con último mensaje entrante de hace más de 1 h, sin `do_not_contact` ni etiqueta que apague al agente. |
| `chat_dashboard_agent(ws, from, to, channel)` | Sobre las conversaciones nuevas: actuó, tomó desde el primer mensaje, derivó. |
| `chat_dashboard_team(ws, from, to, channel)` | Una fila por autor (agente, external, cada persona): salientes, medianas de primera respuesta y de respuesta, % < 1 h. |
| `chat_dashboard_trends(ws, from, to, channel, author, tz)` | Serie diaria: recibidos, enviados, conversaciones nuevas. La app agrupa a semanal si el período supera 62 días. |
| `chat_author_match(author, origin, sent_by_user)` | Helper del filtro "respondido por". |

El período anterior se calcula en la app (`lib/dashboards/period.ts`
`previousPeriod`) y se pide como otro rango de igual duración.

## Verificación

`node scripts/verify-dashboards.mjs` crea un workspace con Owner, Member A,
Member B, un agente, un canal y 6 conversaciones con fechas fijas, llama a las
funciones reales y compara contra los valores calculados a mano (incluido el
caso del Member A, que ve solo las conversaciones 1 y 3). Limpia al terminar.
Correr los scripts `verify-*` de a uno: comparten el prefijo `zz-test-` y la
limpieza de uno colisiona con el arranque del otro si se encadenan.

## Episodios vs. conversaciones

Al 26/9/2026 la base tiene 593 conversaciones. La cantidad de episodios reales
(que es la base de "conversaciones nuevas") se mide con `chat_episodes` cuando
el agente esté prendido y haya datos de operación; con el volumen actual la
diferencia viene sobre todo de conversaciones reabiertas tras inactividad.

## Rendimiento

Las funciones recorren `messages`/`conversations` con índices por
`(workspace_id, created_at)` y `(conversation_id, created_at)`. Con el volumen
actual (~2.400 mensajes) responden muy por debajo del objetivo de 1,5 s. Si al
crecer no se cumpliera, se mide y se anota antes de construir agregados (§14);
no se crean tablas de agregados todavía.

---

## Contenido orgánico (Etapa 2, F48 a F53)

En `/dashboard/dashboards/content`. Se filtra por red y por período, y los
dos van en la URL.

- **Cinco cifras arriba**: seguidores, alcance y vistas, publicaciones,
  engagement promedio y follows orgánicos, cada una con su variación contra
  el período anterior del mismo largo.
- **Crecimiento de seguidores**, con selector Día / Semana / Mes. Cuando la
  red no separa ganados de perdidos —casi ninguna lo hace— se derivan de la
  diferencia entre días, y la pantalla lo llama "neto".
- **Actividad de publicación**, apilada por formato.
- **Engagement en el tiempo**, eligiendo guardados, compartidos, comentarios
  o me gusta.
- **Rendimiento por formato**.
- **Explorador de tendencias**: dos ejes, barras a la izquierda y líneas a la
  derecha, con cualquier métrica en cada uno y una serie por red. Se niega a
  apilar porcentajes y seguidores, y a dibujar una serie que esa red no
  tiene: dice por qué en vez de mostrar una línea en cero. Toda la
  configuración vive en la URL, así que compartir una vista es copiar un link.
- **Engagement a 7 días por semana de publicación**. La semana en curso se
  marca: sus piezas todavía no cumplieron siete días y su promedio va a
  subir. Mostrarla igual que las cerradas haría parecer que el rendimiento se
  derrumbó.
- **Tabla "Tus posts"**, ordenable por cualquier columna. Los que no tienen
  el dato van siempre al final: una columna vacía no puede quedar arriba de
  una llena. Cada fila abre el análisis del post.

Arriba de todo, **"Datos al …"** por red, con el último dato bueno cuando la
última lectura falló. Sin eso, nadie sabe si los números son de hoy o de hace
una semana porque algo se rompió.

### Por qué el engagement a 7 días

Comparar un post de ayer con uno de hace un mes por sus números totales es
comparar cualquier cosa: el viejo tuvo treinta días para juntar likes. A los
siete días el número se congela y recién ahí los posts se comparan entre sí.

## Análisis de un post (F51, F52)

Se abre desde la tabla, desde la grilla de Social y desde el detalle de la
pieza. Flechas para moverse por la lista, Esc para cerrar.

Las fotos diarias son **acumuladas**: el día 5 trae el total de los cinco
días. El gráfico muestra cuánto sumó cada día, que es la diferencia entre
fotos. Si falta una foto, lo que sumó se reparte entre los días sin dato y se
marca como estimado: atribuírselo al último inventaría un pico. Un acumulado
que baja suma cero, nunca un negativo: es una corrección de la red, no gente
que se arrepintió.

La línea punteada es el promedio de los posts del mismo formato y red a la
misma edad. Sin ella, 400 vistas al día 3 no se sabe si va bien o mal.

### Seguidores alrededor de la publicación

**Es una señal, no una atribución, y el rótulo lo dice.** Ninguna red informa
cuántos seguidores trajo un post. Lo que sí se puede saber es cuánto creció
la cuenta el día que salió y el siguiente, comparado con lo normal:

```
sumados = seguidores netos del día + el siguiente
normal  = mediana diaria de los 28 días anteriores × 2
ratio   = sumados ÷ normal
```

La mediana y no el promedio: un día con un post viral arrastraría el promedio
y haría que todo lo demás parezca flojo.

Tres casos borde que se muestran distinto: si el día siguiente no terminó,
dice **"parcial"** y no da ratio; si la cuenta gana uno o dos seguidores por
día, muestra el `+N` sin ratio, porque ahí cualquier post "multiplica por
tres"; y si ese día salieron otras piezas en la misma red, las lista, porque
el salto es de todas juntas.

## Anuncios (F55 a F58)

En `/dashboard/dashboards/ads`. Ocho cifras, evolución diaria de dos ejes,
embudo, retención de video y el desglose por campaña, conjunto y anuncio, con
fila de total.

El **CTR se pinta**: verde arriba de 3,5 %, rojo debajo de 2 %. Los **leads
en cero** se marcan en rojo. Son las dos cosas que se miran para decidir si
una campaña sigue o se apaga.

Cada fila abre su detalle, y un detalle muestra **solo lo suyo**: abrir una
campaña y ver los anuncios de otra es peor que no tener la pantalla, porque
las conclusiones que se sacan son falsas. La cuenta publicitaria y el período
viajan en cada link.

### Qué se guarda y qué se pide en vivo

Los insights diarios se guardan. El **alcance único del período** no: no es
la suma de los alcances diarios, porque la misma persona alcanzada el lunes y
el martes cuenta una vez. Se pide a Meta al abrir la pantalla, sin partir por
día, con caché de quince minutos por cuenta, nivel, objeto y período.

Lo mismo con los desgloses, el objetivo, el presupuesto y el creativo:
guardarlos por día multiplicaría la tabla para algo que se mira de a un
período por vez.

Si una consulta en vivo falla, **solo esa tarjeta** muestra el error.

### Analizar con IA

El botón le pasa al modelo los números reales de la cuenta, en texto, y le
pide que diga qué funciona, qué no y qué conviene hacer. Ve **solo esos
números**: no hay contexto general sobre publicidad.

Se mandan las campañas, conjuntos y anuncios de más gasto (10, 15 y 15), que
son sobre los que hay algo que decidir. Una cuenta con cien anuncios llenaría
el contexto de filas irrelevantes.

El costo queda registrado y los topes de IA del negocio se respetan **antes**
de llamar.

## Unificado (F59)

Lo orgánico y lo pago del mismo período, lado a lado.

**No hay columna de total.** El alcance orgánico y el pago se superponen y
Meta no dice cuánto, así que sumarlos daría un número más grande que la
realidad. Se muestran uno al lado del otro y la tabla lo aclara.

Si falta una de las dos fuentes, se muestra la otra con un aviso. Una
pantalla vacía porque todavía no se conectó Meta escondería lo orgánico, que
sí está.

## Social (F54)

En `/dashboard/social`. El perfil de cada red conectada y su grilla de
publicaciones, con las métricas que la red no muestra al pasar el mouse.

Cada red usa **sus propias cifras y su propia proporción**: Instagram dice
"publicaciones, seguidores, seguidos" en una grilla 3:4; YouTube dice
"suscriptores, videos, vistas" en 16:9. Las mismas tres etiquetas para todas
obligarían a traducir mentalmente, y una grilla cuadrada recorta el Reel y
deja aire en el video.

Entran también las publicaciones hechas a mano, marcadas: la grilla tiene que
parecerse a la real, y la real las incluye.

## De dónde salen los datos

Un cron corre cada hora y encola la recolección para los negocios donde son
las 3 de la mañana en **su** zona horaria. Cada cuenta es un trabajo aparte,
así una red lenta o caída no deja a las otras sin datos.

La frecuencia depende de la antigüedad del post: hasta 30 días, todos los
días; de 31 a 90, una vez por semana; después, no se actualiza más. Pedirle a
la API los mil posts históricos cada noche quema la cuota sin aportar un
dato.

"Actualizar ahora" está en los dashboards y en Social, con un tope de quince
minutos: cada actualización son decenas de llamadas contra APIs con cuota
diaria, y apretar cinco veces seguidas no trae datos más nuevos.

**LinkedIn no da métricas de publicaciones** con los permisos de una app sin
partnership. Se dice en pantalla; no es un error que alguien pueda arreglar
reconectando.
