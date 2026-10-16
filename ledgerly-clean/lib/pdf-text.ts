/**
 * Pull text lines out of a PDF using pdf.js. Works in the browser and in Node (for tests).
 * Items are grouped into lines by their vertical position, then ordered left to right.
 */

export class PdfPasswordError extends Error {
  constructor() {
    super("password-protected");
    this.name = "PdfPasswordError";
  }
}

type PdfjsLike = {
  getDocument: (src: { data: Uint8Array; useSystemFonts?: boolean }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: unknown[] }>;
      }>;
    }>;
  };
};

type Item = { str: string; transform: number[] };

export async function pdfToLines(data: Uint8Array, pdfjs: PdfjsLike, maxPages = 60): Promise<string[]> {
  let doc;
  try {
    doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  } catch (e) {
    if (e && typeof e === "object" && (e as { name?: string }).name === "PasswordException") throw new PdfPasswordError();
    throw e;
  }
  const out: string[] = [];
  const pages = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as unknown[]).filter(
      (i): i is Item => !!i && typeof (i as Item).str === "string" && Array.isArray((i as Item).transform)
    );
    // Group by rounded y (descending = top to bottom), then sort by x.
    const rows = new Map<number, Item[]>();
    for (const it of items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      rows.set(y, [...(rows.get(y) ?? []), it]);
    }
    const ys = Array.from(rows.keys()).sort((a, b) => b - a);
    for (const y of ys) {
      const line = rows
        .get(y)!
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((i) => i.str.trim())
        .join(" ");
      out.push(line);
    }
  }
  return out;
}
