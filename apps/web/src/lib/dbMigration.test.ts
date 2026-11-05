import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { db } from "./db";

it("upgrades an existing v1 database without losing documents, positions, or audio", async () => {
  const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("readaloud", 1);
    request.onupgradeneeded = () => {
      const d = request.result;
      d.createObjectStore("docs", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
      d.createObjectStore("positions", { keyPath: "docId" });
      d.createObjectStore("audio", { keyPath: "key" }).createIndex("createdAt", "createdAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = legacy.transaction(["docs", "positions", "audio"], "readwrite");
  tx.objectStore("docs").put({ id: "saved", updatedAt: 1 });
  tx.objectStore("positions").put({ docId: "saved", fraction: 0.5 });
  tx.objectStore("audio").put({ key: "saved-audio", blob: new Blob(["audio"]), createdAt: 1 });
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  legacy.close();
  const upgraded = await db();
  expect(upgraded.version).toBe(2);
  expect(await upgraded.get("docs", "saved")).toMatchObject({ id: "saved" });
  expect(await upgraded.get("positions", "saved")).toMatchObject({ fraction: 0.5 });
  expect(await upgraded.count("audio")).toBe(1);
  expect(await upgraded.count("outbox")).toBe(0);
});
