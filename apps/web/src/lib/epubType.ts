/** A file larger than this is not one book */
export const MAX_BOOK_BYTES = 60 * 1024 * 1024;

/**
 * An EPUB by its bytes: a zip archive that opens with its `mimetype` entry, as the format asks.
 * One packed more loosely is known by the type or the name it was sent with. Servers often send
 * an EPUB as a plain download, so the type alone settles nothing.
 */
export function isEpubFile(bytes: Uint8Array, contentType = "", name = ""): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return false;
  if (/application\/epub\+zip/i.test(contentType) || /\.epub$/i.test(name)) return true;
  return String.fromCharCode(...bytes.subarray(30, 58)) === "mimetypeapplication/epub+zip";
}
