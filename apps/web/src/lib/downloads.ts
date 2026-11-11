import { isNativeApp } from "./native";
import { withSpeechAuth } from "./speechServer";

function browserDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
}

async function shareFile(filename: string, write: (path: string, uri: string) => Promise<void>) {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const path = `exports/${crypto.randomUUID()}/${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const folder = path.slice(0, path.lastIndexOf("/"));
  await Filesystem.mkdir({ path: folder, directory: Directory.Cache, recursive: true });
  try {
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await write(path, uri);
    await Share.share({ files: [uri], dialogTitle: filename });
  } finally {
    await Filesystem.rmdir({ path: folder, directory: Directory.Cache, recursive: true }).catch(() => {});
  }
}

export async function downloadText(text: string, filename: string, type = "text/plain") {
  if (isNativeApp()) {
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    return shareFile(filename, async (path) => {
      await Filesystem.writeFile({ path, directory: Directory.Cache, data: text, encoding: Encoding.UTF8 });
    });
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  browserDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Stream large dub exports to disk, then offer Save to Files through the iOS share sheet. */
export async function downloadMedia(url: string, filename: string) {
  if (!isNativeApp()) return browserDownload(url, filename);
  const { FileTransfer } = await import("@capacitor/file-transfer");
  return shareFile(filename, async (_path, uri) => {
    const headers = Object.fromEntries(new Headers(withSpeechAuth(url).headers));
    await FileTransfer.downloadFile({ url, path: uri, headers });
  });
}
