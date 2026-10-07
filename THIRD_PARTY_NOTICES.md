# Avisos de terceros

Este proyecto incluye código adaptado de proyectos de código abierto. Cada archivo adaptado lo indica en su encabezado.

## ZernFlow

- Origen: https://github.com/zernio-dev/zernflow
- Uso: este proyecto arrancó como un fork completo de ZernFlow. La base de datos, el motor de flows, la bandeja, el CRM y la autenticación parten de su código; el aviso de copyright original queda en [LICENSE](LICENSE), como exige la licencia MIT.
- Licencia: MIT (ver [LICENSE](LICENSE), que es la licencia de este mismo repositorio).

## Cal.diy

- Origen: https://github.com/calcom/cal.diy (rama `main`, commit `54343aa` del 20/9/2026)
- Uso: lógica del motor de horarios, límites, formulario de reserva, helpers del booker y embed, adaptada en `lib/scheduling/` y `lib/embed/`. El código se copia y adapta; no se importa ningún paquete `@calcom/*`.
- Licencia: MIT (texto completo a continuación).

```
MIT License

Copyright (c) 2020-present Cal.com, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
