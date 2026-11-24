import type { NavigateFunction } from "react-router-dom";
import type { DocRecord } from "./db";
import { usePlayer } from "../state/player";
import { useLibrary } from "../state/library";

export interface OpenOptions {
  resume?: boolean;
  replace?: boolean;
  autoplay?: "openDocument never plays: call listenTo() for a listen gesture (Play, Listen, Resume, Enter on a link)";
}

async function show(rec: DocRecord, navigate: NavigateFunction, opts: OpenOptions, play: boolean) {
  const opened = await usePlayer.getState().open(rec, { autoplay: play, resume: opts.resume ?? true });
  if (!opened) return;
  void useLibrary.getState().touch(rec.id);
  navigate(`/read/${rec.id}`, { replace: opts.replace });
}

/** Load a document into the player and go to the Reader, paused. Opening, importing or uploading is not asking to listen. */
export const openDocument = (rec: DocRecord, navigate: NavigateFunction, opts: OpenOptions = {}) => show(rec, navigate, opts, false);

/** Open a document and read it aloud. Only for a listen gesture: Play, Listen, Resume, Enter on a link, or pasted text. */
export const listenTo = (rec: DocRecord, navigate: NavigateFunction, opts: OpenOptions = {}) => show(rec, navigate, opts, true);

/** openDocument or listenTo, for a caller handed the gesture by its own caller. */
export type Open = typeof openDocument;
