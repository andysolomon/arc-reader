import type { NavigateFunction } from "react-router-dom";
import type { DocRecord } from "./db";
import { usePlayer } from "../state/player";
import { useLibrary } from "../state/library";

/** Load a document into the player and go to the Reader. Autoplay only follows a user gesture. */
export async function openDocument(rec: DocRecord, navigate: NavigateFunction, opts: { autoplay?: boolean; resume?: boolean; replace?: boolean } = {}) {
  await usePlayer.getState().open(rec, { autoplay: opts.autoplay ?? true, resume: opts.resume ?? true });
  void useLibrary.getState().touch(rec.id);
  navigate(`/read/${rec.id}`, { replace: opts.replace });
}
