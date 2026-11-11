import { beforeEach, describe, expect, it, vi } from "vitest";
import { Filesystem } from "@capacitor/filesystem";
import { FileTransfer } from "@capacitor/file-transfer";
import { Share } from "@capacitor/share";
import { downloadMedia, downloadText } from "./downloads";
import { setSpeechEndpoint } from "./speechServer";

vi.mock("./native", () => ({ isNativeApp: () => true }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Cache: "CACHE" }, Encoding: { UTF8: "utf8" }, Filesystem: {
  mkdir: vi.fn().mockResolvedValue(undefined), getUri: vi.fn().mockResolvedValue({ uri: "file:///cache/export.mp4" }),
  writeFile: vi.fn().mockResolvedValue(undefined), rmdir: vi.fn().mockResolvedValue(undefined),
} }));
vi.mock("@capacitor/file-transfer", () => ({ FileTransfer: { downloadFile: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn().mockResolvedValue({ activityType: "files" }) } }));

beforeEach(() => { vi.clearAllMocks(); setSpeechEndpoint({ override: "", key: "" }); });
describe("native Studio exports", () => {
  it("writes a transcript as UTF-8 and shares the actual file", async () => {
    await downloadText("Hello, 世界", "transcript.txt");
    expect(Filesystem.writeFile).toHaveBeenCalledWith(expect.objectContaining({ data: "Hello, 世界", encoding: "utf8", directory: "CACHE", path: expect.stringMatching(/\/transcript\.txt$/) }));
    expect(Share.share).toHaveBeenCalledWith({ files: ["file:///cache/export.mp4"], dialogTitle: "transcript.txt" });
    expect(Filesystem.rmdir).toHaveBeenCalled();
  });
  it("downloads video directly to disk without exposing another server's key", async () => {
    setSpeechEndpoint({ override: "https://other.example", key: "secret" });
    await downloadMedia("https://reader.example/api/vs/dub/download/id", "dub.mp4");
    expect(FileTransfer.downloadFile).toHaveBeenCalledWith({ url: "https://reader.example/api/vs/dub/download/id", path: "file:///cache/export.mp4", headers: {} });
    expect(Share.share).toHaveBeenCalled();
  });
  it("does not share a failed download and cleans its temporary directory", async () => {
    vi.mocked(FileTransfer.downloadFile).mockRejectedValueOnce(new Error("offline"));
    await expect(downloadMedia("https://reader.example/api/vs/dub/download/id", "dub.mp4")).rejects.toThrow("offline");
    expect(Share.share).not.toHaveBeenCalled();
    expect(Filesystem.rmdir).toHaveBeenCalled();
  });
});
