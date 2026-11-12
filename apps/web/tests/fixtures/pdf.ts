/**
 * A PDF written by hand, for tests: one content stream per page, drawn in Helvetica as /F1.
 * Text in a stream is WinAnsi, so a bullet is `\225`.
 */
export function buildPdf(pages: string[], size: [number, number] = [960, 540]): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ...pages.flatMap((content, i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size[0]} ${size[1]}] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    ]),
  ];
  let file = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(file, "latin1");
    file += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(file, "latin1");
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("")}`
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file, "latin1");
}

/** Two slides: a title slide, then one whose title Keynote would draw with a "tt" ligature glyph. */
export const DECK = [
  "BT /F1 60 Tf 150 260 Td (Agent Design) Tj ET BT /F1 30 Tf 150 180 Td (CS 329Z) Tj ET",
  "BT /F1 40 Tf 50 450 Td (Design pa) Tj /Span << /ActualText (tt) >> BDC (=) Tj EMC (erns) Tj ET "
    + "BT /F1 24 Tf 50 300 Td (\\225) Tj 30 0 Td (Workflows chain model calls) Tj ET BT /F1 24 Tf 80 272 Td (in a fixed order) Tj ET "
    + "BT /F1 24 Tf 50 220 Td (\\225) Tj 30 0 Td (Agents choose their next step) Tj ET BT /F1 12 Tf 914 20 Td (2) Tj ET",
];

/** A third slide whose diagram is fifty boxes: drawn, not written, so the text layer has only its title. */
export const DIAGRAM = "BT /F1 40 Tf 50 450 Td (How an agent loops) Tj ET "
  + Array.from({ length: 50 }, (_, i) => `${60 + (i % 10) * 85} ${80 + Math.floor(i / 10) * 60} 70 40 re S`).join(" ");
