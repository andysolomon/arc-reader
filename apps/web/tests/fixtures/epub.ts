/**
 * A small EPUB 3: a cover, a copyright page and three chapters, two of them in one file. As a
 * volume, its title page says which, and the record names only the work, as a series' files do.
 */
export async function buildEpub(volume?: { subtitle: string; chapters: [string, string, string] }): Promise<Buffer> {
  const [first, second, third] = volume?.chapters ?? ["Old Major", "The Rebellion", "The Harvest"];
  const { strToU8, zipSync } = await import("fflate");
  const prose = (about: string) => Array.from({ length: 4 }, (_, p) => `<p>${Array.from({ length: 5 }, (_, i) => `${about} ${p + 1} went on in sentence ${i + 1}, long enough that the paragraph reads as prose.`).join(" ")}</p>`).join("");
  const page = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>The Farmyard</title></head><body>${body}</body></html>`;
  const files: Record<string, string> = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    "OEBPS/content.opf": `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Farmyard</dc:title><dc:creator>Jane Example</dc:creator></metadata>
      <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="copy" href="copyright.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c23" href="ch2-3.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="cover"/><itemref idref="copy"/><itemref idref="c1"/><itemref idref="c23"/></spine></package>`,
    "OEBPS/nav.xhtml": page(`<nav epub:type="toc"><ol><li><a href="cover.xhtml">Cover</a></li><li><a href="copyright.xhtml">Copyright</a></li><li><a href="ch1.xhtml">${first}</a></li><li><a href="ch2-3.xhtml#c2">${second}</a></li><li><a href="ch2-3.xhtml#c3">${third}</a></li></ol></nav>`),
    "OEBPS/cover.xhtml": page(volume ? `<section epub:type="titlepage"><h1>The Farmyard</h1><p class="subtitle">${volume.subtitle}</p></section>` : `<p>Cover picture</p>`),
    "OEBPS/copyright.xhtml": page(`<p>Copyright notice, all rights reserved.</p>`),
    "OEBPS/ch1.xhtml": page(`<section><header><h2>${first}</h2></header>${prose("The meeting")}</section>`),
    "OEBPS/ch2-3.xhtml": page(`<section id="c2"><h2>${second}</h2>${prose("The rebellion")}</section><section id="c3"><h2>${third}</h2>${prose("The harvest")}</section>`),
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))));
}
