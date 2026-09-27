// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * El snippet que pega el cliente en su web (F39, F40). Adaptado de
 * `packages/embeds/embed-snippet/src/index.ts`: define `window.SSA` como una
 * cola de instrucciones y carga `/embed/embed.js`, que después procesa la
 * cola. El objeto global se llama `SSA` (no "Cal").
 *
 * Es un string porque va adentro del código generado; se mantiene chico y
 * legible a propósito.
 */

export const EMBED_SCRIPT_PATH = "/embed/embed.js";

/** El loader, listo para envolver en `<script>`. `scriptUrl` es la URL absoluta de embed.js. */
export function loaderSnippet(scriptUrl: string): string {
  const url = JSON.stringify(scriptUrl);
  return `(function (C, A, L) {
  var p = function (a, ar) { a.q.push(ar); };
  var d = C.document;
  C.SSA = C.SSA || function () {
    var ssa = C.SSA; var ar = arguments;
    if (!ssa.loaded) { ssa.ns = {}; ssa.q = ssa.q || []; d.head.appendChild(d.createElement("script")).src = A; ssa.loaded = true; }
    if (ar[0] === L) {
      var api = function () { p(api, arguments); };
      var namespace = ar[1];
      api.q = api.q || [];
      if (typeof namespace === "string") { ssa.ns[namespace] = ssa.ns[namespace] || api; p(ssa.ns[namespace], ar); p(ssa, ["initNamespace", namespace]); } else p(ssa, ar);
      return;
    }
    p(ssa, ar);
  };
})(window, ${url}, "init");`;
}

export function embedScriptUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}${EMBED_SCRIPT_PATH}`;
}
