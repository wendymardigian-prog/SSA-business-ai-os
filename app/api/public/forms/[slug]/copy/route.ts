import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import { loadContractCopy } from "@/lib/forms/contract/copy-download";
import { contractStorage } from "@/lib/forms/contract/storage";
import { runContractPdf } from "@/lib/forms/contract/pdf-run";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/forms/[slug]/copy?t=<token>: la copia firmada para quien acaba de firmar ("Descargar contrato").
 * Sin sesión: la defensa es el token (24 h, una respuesta, un formulario). La lógica vive en
 * `lib/forms/contract/copy-download.ts`. Nunca se loguea el token.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  try {
    const service = await createServiceClient();
    const result = await loadContractCopy(
      {
        db: service,
        storage: contractStorage(service),
        readLinkSecret: (workspaceId) => readSecret(service, workspaceId, SECRET_NAMES.formsLinkSecret),
        runPdf: (signatureId) => runContractPdf({ db: service }, signatureId),
      },
      { slug, token: request.nextUrl.searchParams.get("t") },
    );
    if (result.kind === "pdf") {
      return new NextResponse(Buffer.from(result.bytes), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${result.filename}"` },
      });
    }
    if (result.kind === "pending") return NextResponse.json({ ok: false, status: "pending" }, { status: 202, headers });
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers });
  } catch (error) {
    console.error("[contract_copy] no pude entregar la copia:", error instanceof Error ? error.message.slice(0, 200) : "error");
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500, headers });
  }
}
