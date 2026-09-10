/**
 * Archivos de prueba reales para los tests de extraccion.
 *
 * Se generan en memoria en vez de commitear binarios: un .pdf y un .docx en el
 * repo no se pueden revisar en un diff, y estos son chiquitos de armar.
 *
 * Existen porque los tests con bytes falsos ("%PDF" y nada mas) prueban la
 * deteccion pero no la conversion, que es la parte que de verdad se puede
 * romper cuando cambia una version de unpdf o de mammoth.
 */

/** Un PDF valido de una pagina con el texto que se le pase. */
export function makePdf(text: string): Uint8Array {
  const encoder = new TextEncoder();
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return encoder.encode(body);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/**
 * Un DOCX valido con un titulo y parrafos.
 *
 * Usa JSZip, que ya viene con mammoth: un .docx es un ZIP con tres archivos.
 */
export async function makeDocx(heading: string, paragraphs: string[]): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");

  const escapeXml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const body = [
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(heading)}</w:t></w:r></w:p>`,
    ...paragraphs.map((p) => `<w:p><w:r><w:t>${escapeXml(p)}</w:t></w:r></w:p>`),
  ].join("");

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", document);

  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
