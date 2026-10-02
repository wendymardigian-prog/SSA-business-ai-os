# Pendiente — Bloque N (menú lateral)

## No se pudieron tomar las capturas a 1440 px y 390 px

`/dashboard` redirige a `/login`: no hay sesión activa en este entorno de
trabajo. El login de Supabase manda las credenciales a la URL remota del
proyecto (`NEXT_PUBLIC_SUPABASE_URL`), no a `localhost`, así que no aplica la
excepción de "credenciales de prueba contra la propia app" (esa excepción es
solo para hosts que son literalmente `localhost`/`127.0.0.1`/`.test`). Por
regla, no se ingresan credenciales ahí.

**Lo que sí se verificó**, sin necesidad de sesión:
- `npx vitest run`: 340 archivos, 4233 tests, todo verde (incluye los tests
  nuevos de `lib/nav/items.test.ts` y `lib/nav/active.test.ts`, que cubren
  los grupos, el orden, los separadores del colapsado, el tooltip y el
  estado activo para las 47 rutas de `PAGE_META`).
- `npm run build`: compila sin errores.
- `npm run lint`: 0 errores (los 38 warnings son preexistentes, ninguno en
  los archivos tocados).
- Lectura del código final de `components/sidebar.tsx` y
  `components/dashboard-chrome.tsx` contra los cinco criterios de N1, N2,
  N3 y N4.

**Lo que falta, y cómo cerrarlo:** con una sesión abierta (tu usuario, en tu
navegador), entrar a `/dashboard` y mirar:
1. El menú expandido: Dashboards y Bandeja sueltos arriba; Adquisición
   (Contenido, Social); Ventas (Contactos, Agenda); Automatización
   (Automatizaciones, Agentes, Conocimiento); una línea y, al fondo,
   Integraciones y Ajustes.
2. Colapsarlo (botón arriba del menú): los títulos de grupo desaparecen y
   quedan líneas finas entre grupos; pasar el mouse por un ícono como
   Contactos tiene que mostrar "Contactos · Ventas".
3. En el teléfono (o achicando la ventana a 390 px y abriendo el menú del
   celular): se ven los mismos grupos, con sus títulos, sin colapsar nunca.
4. Entrar a `/dashboard/settings/integrations`, `/dashboard/settings/team` y
   `/dashboard/channels`: en cada una, un solo ítem marcado (Integraciones en
   las dos primeras... la primera, Ajustes en la segunda, Integraciones en la
   tercera).
5. Confirmar que `/dashboard/channels` sigue abriendo entera (QR de
   WhatsApp, alta de canales, sincronización): el ítem salió del menú, la
   pantalla no se tocó.

Si confirmás que se ve bien, no hace falta nada más de mi lado para este
bloque. Si algo no coincide con lo de arriba, decímelo con la ruta y lo
reviso.

## Un título que va a quedar inconsistente por un bloque más

La barra superior (`PAGE_META`, en `lib/nav/page-actions.ts`) todavía dice
**"Flows"** en `/dashboard/flows` e **"Inbox"** en `/dashboard/inbox`,
mientras el menú ya dice **Automatizaciones** y **Bandeja**. Es el mismo tipo
de inconsistencia que el documento de requerimientos señala para Inbox (la
resuelve el Bloque I, en I2, cambiando el título de esa barra a "Bandeja").
**Pero nada en el documento le asigna el cambio a "Flows" → "Automatizaciones"**:
ni el Bloque N (que no toca `page-actions.ts` a propósito) ni ningún otro
bloque lo menciona. Lo dejo anotado para que decidas quién lo hace: si querés,
lo agrego como una línea suelta en el Bloque I (ya que ese bloque sí toca
`PAGE_META` para Inbox) o lo resuelvo en una sesión aparte, un cambio de una
línea.
