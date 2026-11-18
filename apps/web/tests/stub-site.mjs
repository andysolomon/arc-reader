// Stand-in websites for tests, served where both the browser and the app server can reach
// them: the app server fetches a book's chapters itself, so the browser can't fake them.
//   /                 a three-chapter book whose pages list each other ("Backend Basics")
//   /cs101/           a course page linking one PDF deck per lecture posted so far
//   POST /cs101/posted?count=n   posts lectures up to n
//   node tests/stub-site.mjs [port]
import { createServer } from "node:http";

const { buildPdf } = await import("./fixtures/pdf.ts");
const PORT = Number(process.argv[2] || process.env.STUB_PORT || 3996);

const CHAPTERS = [
  ["01-http", "HTTP & CORS", "<h2>Why HTTP</h2><p>It carries every request and every response.</p>"],
  ["02-routing", "Routing", `<h2>Static routes</h2><p>A route names a resource on the server. The router matches each request to one.</p>
    <aside class="callout"><p>Mental model</p><p>Methods say what, routes say where.</p></aside>
    <table><thead><tr><th>Part</th><th>Meaning</th></tr></thead><tbody><tr><td>Path</td><td>Which resource</td></tr></tbody></table>
    <h3>Dynamic routes</h3><p>A parameter stands in for part of the path. That keeps one route for every user.</p>`],
  ["03-databases", "Databases", "<h2>Why databases exist</h2><p>They persist data across sessions. Disk is roomy and cheap.</p>"],
];
const nav = `<nav aria-label="All chapters"><a href="/">Overview</a><ol>${CHAPTERS.map(([slug, title], i) => `<li><a href="/${slug}/"><span>0${i + 1}</span><span>${title}</span></a></li>`).join("")}</ol></nav>`;
const BOOK = {
  "/": `<title>Backend Basics — a three-chapter reference</title>${nav}<main><h1>Backend Basics</h1><p>Every chapter is a field manual for one part of the backend.</p></main>`,
  ...Object.fromEntries(CHAPTERS.map(([slug, title, body], i) => [`/${slug}/`, `<title>${title} · Chapter 0${i + 1} · Backend Basics</title>${nav}<main><article>${body}</article></main>`])),
};

const LECTURES = ["Introduction to Systems", "Models for Builders", "Retrieval", "Tools"];
let posted = 3;
/** The course page as it stands once `posted` lectures have slides: a schedule whose links only say "Slides". */
const schedule = () => `<!doctype html><html><head><meta charset="utf-8"><title>CS101 | Building Things</title></head><body>
  <h1>CS 101: Building Things</h1><p>Welcome to the course. Lecture materials are linked here as they are released.</p>
  <table><thead><tr><th>Week</th><th>Date</th><th>Lecture</th></tr></thead><tbody>${LECTURES.map((title, i) => `<tr><td>${i + 1}</td><td>Mon Sep ${21 + i}</td>
    <td><span class="lec-title">${title}</span><span class="lec-desc">What this lecture covers.</span>${i < posted ? `<a href="/cs101/slides/lecture0${i + 1}.pdf">Slides</a>` : ""}</td></tr>`).join("")}
  </tbody></table></body></html>`;
const deck = (n) => buildPdf([
  `BT /F1 60 Tf 150 260 Td (Deck ${n}) Tj ET BT /F1 30 Tf 150 180 Td (CS 101) Tj ET`,
  `BT /F1 40 Tf 50 450 Td (Topic ${n}) Tj ET BT /F1 24 Tf 50 300 Td (Lecture ${n} makes a point long enough to be read aloud) Tj ET`,
]);

const send = (res, status, type, body) => {
  res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "cache-control": "no-store" });
  res.end(body);
};

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return send(res, 200, "application/json", '{"status":"ok"}');
  if (url.pathname === "/cs101/posted" && req.method === "POST") {
    posted = Number(url.searchParams.get("count")) || 0;
    return send(res, 200, "application/json", JSON.stringify({ posted }));
  }
  if (url.pathname === "/cs101/") return send(res, 200, "text/html; charset=utf-8", schedule());
  const n = Number(url.pathname.match(/^\/cs101\/slides\/lecture0(\d)\.pdf$/)?.[1]);
  if (n && n <= posted) return send(res, 200, "application/pdf", deck(n));
  const html = BOOK[url.pathname];
  if (html) return send(res, 200, "text/html; charset=utf-8", `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
  send(res, 404, "text/plain", "Not found");
}).listen(PORT, "127.0.0.1", () => console.log(`stub site on :${PORT}`));
