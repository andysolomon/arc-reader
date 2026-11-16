import { lstat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The preview server keeps one run's library and preparations here. The config and this
// global setup both run in Playwright's runner process, so they name the same folder.
export const runDataDir = join(tmpdir(), `readaloud-e2e-${process.pid}`);
export const libraryDataDir = join(runDataDir, "library");
export const preparationDataDir = join(runDataDir, "preparations");

// Matches this folder and the separate readaloud-e2e-{library,preparations}-<pid> folders used before it.
const RUN_FOLDER = /^readaloud-e2e-(?:library-|preparations-)?(\d+)$/;

function running(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Runs that were killed never reach teardown. A folder is kept while its PID is running,
// so a run in another worktree keeps its data, and a reused PID can only keep a folder.
async function removeAbandoned() {
  const uid = process.getuid?.();
  for (const name of await readdir(tmpdir())) {
    const pid = Number(RUN_FOLDER.exec(name)?.[1]);
    if (!pid || running(pid)) continue;
    const path = join(tmpdir(), name);
    const info = await lstat(path).catch(() => undefined);
    if (!info?.isDirectory() || (uid !== undefined && info.uid !== uid)) continue;
    await rm(path, { recursive: true, force: true }).catch((error) => console.warn(`Could not remove ${path}:`, error));
  }
}

export default async function globalSetup() {
  await removeAbandoned().catch((error) => console.warn("Could not remove abandoned E2E data:", error));
  return async () => {
    await rm(runDataDir, { recursive: true, force: true }).catch((error) => console.warn(`Could not remove ${runDataDir}:`, error));
  };
}
