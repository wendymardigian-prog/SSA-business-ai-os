# Protocolo de trabajo: primero el plan, después todo de corrido

Quien usa este proyecto puede no ser técnico. Por eso se trabaja siempre igual: se entiende bien el pedido, se acuerda un plan por escrito y recién después se ejecuta, sin interrupciones. Las reglas de acá valen para todo pedido, aunque la persona no las mencione.

## Regla 0

- Las **preguntas y explicaciones** se contestan directo, sin plan.
- Todo lo que **modifica archivos, la base de datos o la configuración** arranca con un plan aprobado. Nada se edita antes.
- **Cada pedido nuevo vuelve a empezar**, incluso en la misma sesión y justo después de ejecutar otro plan: antes de tocar nada, entrá en modo plan (`EnterPlanMode`).

## Paso 1: entender, sin molestar de más

- Leé el código antes de preguntar. Lo que se puede averiguar mirando el proyecto no se le pregunta a la persona.
- Preguntale solo lo que es **decisión suya**: qué quiere, qué prefiere, qué le importa más. Hacelo en **una sola ronda** (`AskUserQuestion`), en lenguaje simple, con tu recomendación en cada pregunta y el motivo.
- Recorré los casos borde (la lista completa está en `/planificar`) y resolvé con la persona los que cambian el resultado: datos vacíos, dos personas a la vez, falla de un servicio externo, permisos, celular, datos que ya existen.
- Si más adelante surge algo que cambia el plan, volvé a preguntar **antes** de ejecutar, no durante.

## Paso 2: el plan, siempre en dos partes

Va en el chat **y** en el archivo del plan. Arriba de todo, un bloque **«Cómo ejecutarlo»**: modelo, nivel de esfuerzo, modo de permisos que tiene que elegir la persona al aprobar, y por qué.

- **Parte A, «Resumen para vos»**: lo que una persona no técnica necesita saber. Qué va a tener cuando termine, qué cambia para quien lo usa, qué **no** cambia, qué riesgos hay (en palabras simples), qué decisiones se tomaron y qué se le va a pedir. Sin términos técnicos; si uno es inevitable, se explica entre paréntesis.
- **Parte B, «Plan para Claude»**: contexto, decisiones tomadas, qué queda fuera, archivos a tocar, pasos en orden, casos borde resueltos, criterios de aceptación (observables) y cómo se verifica.
- **Cambios mínimos** (un texto, un typo, un color): plan corto de tres líneas: qué se cambia, dónde y qué podría salir mal, más una línea con modelo y esfuerzo.

### Modelo y esfuerzo recomendados

| Tipo de pedido | Modelo | Esfuerzo |
|---|---|---|
| Textos, estilos, typos | Sonnet 5.5 o Haiku 5.5 | bajo |
| Funcionalidad normal | Sonnet 5.5 | medio o alto |
| Base de datos, permisos, seguridad, flujos, cruzar módulos | Opus 5.5 | alto |
| Duda real de diseño o un error que no cede | Fable 5.2 | muy alto |

Ante la duda, el escalón de arriba. Si la persona ya eligió modelo, respetalo y avisale solo si el trabajo lo merece.

## Paso 3: aprobar

Se sale del modo plan con `ExitPlanMode`. El plan le dice a la persona qué opción elegir al aprobar (para que se ejecute sin pedir permiso en cada paso, «use auto mode» o «auto-accept edits»).

## Paso 4: ejecutar de corrido

- Armá la lista de tareas, trabajá en una rama o worktree, hacé commits chicos (`feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `test`) y **no vuelvas a preguntar lo que el plan ya resolvió**.
- Si aparece una decisión que el plan no cubría y se puede deshacer: elegí el valor más razonable, anotalo y seguí. Se lo contás al final.
- **Frená y preguntá siempre, aunque estés ejecutando**, ante: borrar datos o archivos, tocar producción o la base real, pedir o usar claves y contraseñas, algo que contradice el plan, un gasto que no estaba previsto, o subir a `main` / publicar. Nunca le pidas una clave a la persona por chat: decile dónde pegarla.
- No agregues nada que no esté en el plan. Si ves algo que conviene, anotalo como sugerencia al cerrar.

## Paso 5: cerrar

Resumen en lenguaje simple: qué quedó hecho, qué se probó, qué **no** se pudo verificar y qué tiene que hacer la persona (si algo). Nunca digas «listo» si algo falló: decí qué falló y cómo lo vas a resolver.

## Definición de terminado

Un trabajo está terminado cuando:
- compila (`npx tsc --noEmit`), pasa el lint (`npm run lint`) y los tests (`npx vitest run`);
- la pantalla tocada se miró funcionando, o se dice con claridad que no se pudo;
- si hay una variable de entorno nueva, está en `.env.example` con su comentario;
- si hay cambio en la base, la migración es idempotente y está numerada a continuación de la última;
- no queda ninguna clave ni dato personal en el código ni en los logs.
