#!/usr/bin/env node
/**
 * Verificacion de la base de conocimiento: embeddings de Voyage + pgvector.
 *
 * Prueba lo que los tests de vitest NO pueden probar: que la busqueda semantica
 * de verdad encuentra lo que uno le pide. Los tests mockean a Voyage y usan
 * vectores inventados; eso verifica el cableado, no que buscar "cuanto sale el
 * plan caro" devuelva el fragmento de precios.
 *
 * Que hace: pide embeddings reales a Voyage para tres fragmentos de temas
 * distintos, los guarda en pgvector, hace tres consultas en lenguaje natural, y
 * verifica que cada una traiga primero el fragmento que corresponde. Despues
 * borra todo lo que creo.
 *
 * Necesita la key de Voyage cargada en Vault desde Ajustes > Integraciones. Si
 * no esta, lo dice y sale sin fallar: no es un error del codigo.
 *
 *   node scripts/verify-knowledge.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const DIMENSIONS = 1024;

/** Los fragmentos de prueba: tres temas bien distintos entre si. */
const FRAGMENTOS = [
  {
    tema: "precios",
    texto:
      "El plan basico cuesta 500 dolares por mes e incluye dos campanas activas. El plan avanzado cuesta 1200 dolares por mes e incluye campanas ilimitadas y soporte prioritario.",
  },
  {
    tema: "reembolsos",
    texto:
      "Se devuelve el dinero dentro de los 30 dias de la contratacion, sin preguntas. Pasados los 30 dias no se hacen devoluciones, pero se puede pausar la cuenta.",
  },
  {
    tema: "horarios",
    texto:
      "El equipo de soporte atiende de lunes a viernes de 9 a 18, hora de Buenos Aires. Los fines de semana solo se responden urgencias por WhatsApp.",
  },
];

/** Consultas en lenguaje natural, sin repetir las palabras del fragmento. */
const CONSULTAS = [
  { pregunta: "cuanto sale la version mas cara?", esperado: "precios" },
  { pregunta: "puedo pedir que me devuelvan la plata?", esperado: "reembolsos" },
  { pregunta: "a que hora puedo hablar con alguien?", esperado: "horarios" },
];

async function embed(apiKey, textos, inputType, modelo) {
  const response = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: textos,
      model: modelo,
      input_type: inputType,
      output_dimension: DIMENSIONS,
      truncation: true,
    }),
  });

  if (!response.ok) {
    const detalle = await response.text().catch(() => "");
    throw new Error(`Voyage respondio ${response.status}: ${detalle.slice(0, 200)}`);
  }

  const payload = await response.json();
  const filas = payload.data ?? [];
  const ordenados = new Array(textos.length);
  for (let i = 0; i < filas.length; i++) {
    ordenados[filas[i].index ?? i] = filas[i].embedding;
  }
  return { embeddings: ordenados, tokens: payload.usage?.total_tokens ?? 0 };
}

const toPgVector = (e) => `[${e.join(",")}]`;

let documentoId = null;
let workspaceId = null;

try {
  console.log("— Configuracion —");

  const { data: ws } = await svc.from("workspaces").select("id, name").limit(1).single();
  if (!ws) {
    console.error("No hay ningun workspace en la base. Crea uno registrandote en la app.");
    process.exit(1);
  }
  workspaceId = ws.id;
  ok(`workspace: ${ws.name}`);

  const { data: config } = await svc
    .from("integration_configs")
    .select("vault_secret_name, config")
    .eq("workspace_id", workspaceId)
    .eq("type", "ai_provider")
    .eq("provider", "voyage")
    .eq("is_active", true)
    .maybeSingle();

  if (!config) {
    console.log("\n  Voyage AI no esta conectado en este workspace.");
    console.log("  Carga la key en la app: Ajustes > Integraciones > Voyage AI.");
    console.log("  (La key va a Vault, no a un archivo. Este script la lee de ahi.)\n");
    process.exit(0);
  }
  ok("Voyage AI conectado");

  const { data: apiKey, error: eKey } = await svc.rpc("read_secret", {
    secret_name: config.vault_secret_name ?? "voyage_api_key",
    workspace_id: workspaceId,
  });

  if (eKey || !apiKey) {
    fail("no pude leer la key de Voyage desde Vault", eKey?.message);
    process.exit(1);
  }
  ok("key leida desde Vault");

  const modelo = config.config?.embedding_model || "voyage-4-lite";
  ok(`modelo: ${modelo}`);

  console.log("\n— Embeddings —");

  const indexado = await embed(
    apiKey,
    FRAGMENTOS.map((f) => f.texto),
    "document",
    modelo,
  );

  check(
    indexado.embeddings.length === FRAGMENTOS.length,
    `Voyage devolvio ${indexado.embeddings.length} embeddings para ${FRAGMENTOS.length} fragmentos`,
  );

  const dimension = indexado.embeddings[0]?.length;
  check(
    dimension === DIMENSIONS,
    `la dimension es ${DIMENSIONS} (la que espera la columna)`,
    dimension !== DIMENSIONS ? `vinieron ${dimension}` : undefined,
  );
  ok(`consumidos ~${indexado.tokens} tokens del free tier`);

  console.log("\n— Guardado en pgvector —");

  const { data: doc, error: eDoc } = await svc
    .from("knowledge_base")
    .insert({
      workspace_id: workspaceId,
      title: "zz-verify-knowledge",
      status: "ready",
      chunk_count: FRAGMENTOS.length,
      embedding_model: modelo,
      indexed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (eDoc || !doc) {
    fail("no pude crear el documento de prueba", eDoc?.message);
    process.exit(1);
  }
  documentoId = doc.id;

  const { error: eChunks } = await svc.from("knowledge_chunks").insert(
    FRAGMENTOS.map((fragmento, i) => ({
      workspace_id: workspaceId,
      document_id: documentoId,
      chunk_index: i,
      content: fragmento.texto,
      token_estimate: Math.ceil(fragmento.texto.length / 4),
      embedding: toPgVector(indexado.embeddings[i]),
    })),
  );

  check(!eChunks, `${FRAGMENTOS.length} fragmentos guardados`, eChunks?.message);
  if (eChunks) process.exit(1);

  console.log("\n— Busqueda semantica —");
  console.log("  (las consultas NO repiten las palabras del fragmento)\n");

  const consulta = await embed(
    apiKey,
    CONSULTAS.map((c) => c.pregunta),
    "query",
    modelo,
  );

  for (let i = 0; i < CONSULTAS.length; i++) {
    const { pregunta, esperado } = CONSULTAS[i];

    const { data: resultados, error } = await svc.rpc("match_knowledge_chunks", {
      p_workspace_id: workspaceId,
      p_query_embedding: toPgVector(consulta.embeddings[i]),
      p_match_count: 3,
      p_min_similarity: 0,
    });

    if (error) {
      fail(`"${pregunta}"`, error.message);
      continue;
    }

    const primero = resultados?.[0];
    const temaDevuelto = primero ? FRAGMENTOS[primero.chunk_index]?.tema : null;
    const similitud = primero ? primero.similarity.toFixed(3) : "-";

    check(
      temaDevuelto === esperado,
      `"${pregunta}" → ${temaDevuelto} (similitud ${similitud})`,
      temaDevuelto !== esperado ? `se esperaba "${esperado}"` : undefined,
    );
  }

  console.log("\n— Filtros de la busqueda —");

  { const { data } = await svc.rpc("match_knowledge_chunks", {
      p_workspace_id: workspaceId,
      p_query_embedding: toPgVector(consulta.embeddings[0]),
      p_match_count: 1,
      p_min_similarity: 0,
    });
    check((data ?? []).length === 1, "match_count limita la cantidad de resultados"); }

  { const { data } = await svc.rpc("match_knowledge_chunks", {
      p_workspace_id: workspaceId,
      p_query_embedding: toPgVector(consulta.embeddings[0]),
      p_match_count: 10,
      p_min_similarity: 0.99,
    });
    check((data ?? []).length === 0, "min_similarity descarta lo que no se parece lo suficiente"); }

  { // Un documento borrado no tiene por que seguir contestando.
    await svc.from("knowledge_base")
      .update({ deleted_at: new Date().toISOString() }).eq("id", documentoId);

    const { data } = await svc.rpc("match_knowledge_chunks", {
      p_workspace_id: workspaceId,
      p_query_embedding: toPgVector(consulta.embeddings[0]),
      p_match_count: 10,
      p_min_similarity: 0,
    });
    check((data ?? []).length === 0, "un documento eliminado desaparece de la busqueda");

    await svc.from("knowledge_base").update({ deleted_at: null }).eq("id", documentoId); }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  if (documentoId) {
    const { error } = await svc.from("knowledge_base").delete().eq("id", documentoId);
    if (error) {
      fail("no pude borrar el documento de prueba", error.message);
    } else {
      const { data: restos } = await svc
        .from("knowledge_chunks")
        .select("id")
        .eq("document_id", documentoId);
      check((restos ?? []).length === 0, "documento y fragmentos de prueba borrados");
    }
  } else {
    ok("nada que limpiar");
  }
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
