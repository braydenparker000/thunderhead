// A small, real PDF for Study's tests, written by hand: `pages` pages of text in Helvetica, the
// title and author in its Info, printed page labels (the first page "i", then 1, 2, …), and an
// unreferenced filler stream of `filler` bytes in the middle, so a reader asking in 256 KB ranges
// needs more than one. All text is invented.

/** @param {{ pages?: number, title?: string, author?: string, filler?: number, text?: (n: number) => string }} [o] */
export function makePdf(o = {}) {
  const pages = o.pages ?? 3;
  const text = o.text ?? ((n) => `Page ${n} of a synthetic book about the morning light.`);
  const objs = [];
  const kids = [];
  // 1 catalog, 2 pages, 3 font, 4 info, 5 filler, then a page and its contents per page.
  objs[1] = '<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 1 << /S /D >>] >> >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objs[4] = `<< /Title (${o.title ?? 'A Synthetic Commentary'}) /Author (${o.author ?? 'Nobody'}) >>`;
  const fill = 'x'.repeat(o.filler ?? 0);
  objs[5] = `<< /Length ${fill.length} >>\nstream\n${fill}\nendstream`;
  for (let n = 1; n <= pages; n++) {
    const page = 4 + 2 * n;
    const content = page + 1;
    const body = `BT /F1 18 Tf 36 340 Td (${text(n)}) Tj ET`;
    objs[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Contents ${content} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[content] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
    kids.push(`${page} 0 R`);
  }
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
