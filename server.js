import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import * as store from "./lib/store.js";
import { plan, parisToIso } from "./lib/calendar.js";
import { TOPICS, generatePost, generateBatch, allowedNumbersFor } from "./lib/generate.js";
import { lint } from "./lib/rules.js";
import { feed, maxQueue } from "./lib/feeder.js";
import { hasToken, discoverChannels } from "./lib/buffer.js";
import { publishReel } from "./lib/reel.js";

store.load();
const PORT = Number(process.env.PORT || 3000);
const html = () => fs.readFileSync(new URL("./public/index.html", import.meta.url));

function authorized(req) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return false;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const given = Buffer.from(h.slice(6), "base64").toString().split(":").slice(1).join(":");
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(pw).digest();
  return crypto.timingSafeEqual(a, b);
}

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type + "; charset=utf-8", "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((ok) => {
  let d = ""; req.on("data", (c) => (d += c));
  req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch { ok({}); } });
});

function relint(p) {
  const topic = TOPICS.find((t) => t.id === p.topicId);
  p.lint = lint(p.text, p.channel, { allowedNumbers: allowedNumbersFor(p, topic), knownPhrases: ["01 45 51 62 13"] });
}

function approvable(p) {
  if (!p.text.trim()) return "texte vide";
  if (p.lint.errors.length) return "erreurs de règles à corriger";
  if (p.status === "needs_data") return "données de l'agence à renseigner";
  if (p.channel === "instagram" && !p.image) return "Instagram exige une image";
  if (Date.parse(p.dueAt) < Date.now()) return "date passée";
  return null;
}

function nextMonday() {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const routes = {
  "GET /api/state": async () => {
    const posts = store.listPosts();
    const count = {};
    for (const p of posts) count[p.status] = (count[p.status] || 0) + 1;
    return { posts, count, job: store.get().job, config: { bufferKey: hasToken(), anthropicKey: !!process.env.ANTHROPIC_API_KEY, maxQueue: maxQueue() } };
  },
  "POST /api/plan": async (_, b) => {
    const created = plan({ start: b.start || nextMonday(), weeks: Math.min(Number(b.weeks) || 26, 52), topics: TOPICS, existing: store.listPosts() });
    for (const p of created) store.putPost(p);
    return { created: created.length };
  },
  "POST /api/generate-batch": async (_, b) => {
    const ids = store.listPosts()
      .filter((p) => (p.status === "planned") && (!b.from || p.date >= b.from) && (!b.to || p.date <= b.to))
      .map((p) => p.id);
    generateBatch(ids).catch(() => {});
    return { started: ids.length };
  },
  "POST /api/approve-range": async (_, b) => {
    let n = 0;
    for (const p of store.listPosts()) {
      if (p.status !== "drafted" || (b.from && p.date < b.from) || (b.to && p.date > b.to)) continue;
      if (!approvable(p)) { p.status = "approved"; store.putPost(p); n++; }
    }
    return { approved: n };
  },
  "POST /api/sync": async () => feed(),
  "GET /api/discover": async () => {
    if (!hasToken()) throw Object.assign(new Error("BUFFER_TOKEN_CLAYIMMO absente"), { code: 400 });
    return discoverChannels();
  },
};

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if ((req.method === "GET" || req.method === "HEAD") && /^\/media\/[\w.-]+\.(mp4|jpg)$/.test(url.pathname)) {
    const f = new URL("." + url.pathname, import.meta.url);
    if (!fs.existsSync(f)) return send(res, 404, "introuvable", "text/plain");
    const size = fs.statSync(f).size, type = url.pathname.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    if (range && req.method === "GET") {
      const a = range[1] ? Number(range[1]) : 0, b = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${a}-${b}/${size}`, "content-length": b - a + 1 });
      return fs.createReadStream(f, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size, "cache-control": "public, max-age=3600" });
    return req.method === "HEAD" ? res.end() : fs.createReadStream(f).pipe(res);
  }
  if (!process.env.APP_PASSWORD) return send(res, 503, "APP_PASSWORD non défini : l'interface reste fermée tant qu'il manque.", "text/plain");
  if (!authorized(req)) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="ClayImmo moteur"' });
    return res.end("Authentification requise");
  }
  if (req.method === "GET" && url.pathname === "/") return send(res, 200, html(), "text/html");

  const key = `${req.method} ${url.pathname}`;
  const body = req.method === "GET" ? {} : await readBody(req);
  try {
    if (routes[key]) return send(res, 200, await routes[key](req, body));

    const m = url.pathname.match(/^\/api\/posts\/([\w-]+)(?:\/(\w+))?$/);
    if (m) {
      const p = store.getPost(m[1]);
      if (!p) return send(res, 404, { error: "introuvable" });
      const act = m[2];
      if (req.method === "PATCH" && !act) {
        if (p.status === "queued") return send(res, 409, { error: "déjà programmée dans Buffer : modifier ou supprimer dans Buffer" });
        for (const k of ["text", "image", "data", "visuel"]) if (typeof body[k] === "string") p[k] = body[k];
        if (body.date && body.time) { p.date = body.date; p.time = body.time; p.dueAt = parisToIso(body.date, body.time); }
        if (p.text.trim()) { relint(p); if (["planned", "needs_data", "approved", "drafted", "needs_edit", "error"].includes(p.status)) p.status = p.lint.errors.length ? "needs_edit" : "drafted"; }
        return send(res, 200, store.putPost(p));
      }
      if (req.method === "POST" && act === "generate") return send(res, 200, await generatePost(p.id));
      if (req.method === "POST" && act === "approve") {
        const why = approvable(p);
        if (why) return send(res, 422, { error: why });
        p.status = "approved"; return send(res, 200, store.putPost(p));
      }
      if (req.method === "POST" && act === "unapprove" && p.status === "approved") { p.status = "drafted"; return send(res, 200, store.putPost(p)); }
      if (req.method === "DELETE" && !act) {
        if (p.status === "queued") return send(res, 409, { error: "supprimer d'abord dans Buffer" });
        delete store.get().posts[p.id]; store.save(); return send(res, 200, { deleted: true });
      }
    }
    send(res, 404, { error: "route inconnue" });
  } catch (e) {
    send(res, e.code === 400 ? 400 : 500, { error: String(e.message || e) });
  }
}

http.createServer((req, res) => handle(req, res).catch((e) => send(res, 500, { error: String(e) }))).listen(PORT, () => {
  console.log(`ClayImmo moteur sur le port ${PORT}`);
  setTimeout(() => publishReel().catch((e) => console.error("[reel] échec :", e.message)), 20000);
});
setInterval(() => feed().then((r) => r.log?.length && console.log(r.log.join("\n"))).catch((e) => console.error("feed:", e.message)), 10 * 60e3);
