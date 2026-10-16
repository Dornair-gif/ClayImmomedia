// Contenus validés par Maneli (planned/*.json), envoyés au Buffer ClayImmo au fil de l'eau.
// Le plan gratuit de Buffer limite la file : on garde au plus PLANNED_MAX publications en attente
// et on complète toutes les heures, du plus proche au plus lointain. Idempotent via DATA_DIR/planned-done.json.
import fs from "node:fs";
import path from "node:path";
import { gql, discoverChannels } from "./buffer.js";

const DATA = process.env.DATA_DIR || "./data";
const DONE = path.join(DATA, "planned-done.json");
const MAX = Number(process.env.PLANNED_MAX || 7);
const base = () => (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const log = (...a) => console.log("[planned]", ...a);
const readDone = () => { try { return JSON.parse(fs.readFileSync(DONE, "utf8")); } catch { return {}; } };
const writeDone = (o) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(DONE, JSON.stringify(o, null, 2)); };
const CREATE = `mutation($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id dueAt status } }
    ... on MutationError { message }
  }
}`;

function loadItems() {
  const dir = new URL("../planned/", import.meta.url);
  if (!fs.existsSync(dir)) return [];
  const items = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const plan = JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
    for (const it of plan.items) items.push({ thumbnailOffsetMs: plan.thumbnailOffsetMs ?? 300, channel: "instagram", ...it });
  }
  return items.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

function buildInput(it, channelId) {
  const m = (f) => `${base()}/media/${f}`;
  const input = { channelId, text: it.text, schedulingType: "automatic", mode: "customScheduled", dueAt: it.dueAt };
  if (it.video) input.assets = [{ video: { url: m(it.video), metadata: { thumbnailOffset: it.thumbnailOffsetMs } } }];
  else if (it.images) input.assets = it.images.map((f) => ({ image: { url: m(f), metadata: { altText: it.alt || "ClayImmo" } } }));
  if (it.channel === "instagram") input.metadata = { instagram: { type: it.video ? "reel" : "post", shouldShareToFeed: true } };
  if (it.channel === "google") input.metadata = { google: { type: "whats_new", detailsWhatsNew: { button: "learn_more", link: it.link || "https://clayimmo.com" } } };
  return input;
}

export async function schedulePlanned() {
  if (!process.env.BUFFER_TOKEN_CLAYIMMO || !base()) { log("clé Buffer ou PUBLIC_URL manquant"); return; }
  const items = loadItems();
  if (!items.length) return;
  const done = readDone();
  const now = Date.now();
  const waiting = Object.values(done).filter((p) => Date.parse(p.dueAt) > now).length;
  let room = MAX - waiting;
  if (room <= 0) { log("file pleine", waiting); return; }
  const { all } = await discoverChannels();
  const ch = (svc) => all.find((c) => String(c.service).toLowerCase().includes(svc) && !c.isDisconnected && (svc === "google" || /clay/i.test(c.name)));
  for (const it of items) {
    if (room <= 0) break;
    if (done[it.key]) continue;
    if (Date.parse(it.dueAt) < now + 30 * 60e3) { log("date passée, ignoré", it.key); continue; }
    const c = ch(it.channel);
    if (!c) { log("canal introuvable", it.channel, it.key); continue; }
    try {
      const r = (await gql(CREATE, { input: buildInput(it, c.id) })).createPost;
      if (r.__typename === "MutationError" || r.message) { log("refus", it.key, r.message); continue; }
      done[it.key] = r.post; writeDone(done); room--; log("OK", it.key, JSON.stringify(r.post));
    } catch (e) { log("erreur", it.key, e.message); }
  }
}

export function startPlanned() {
  const run = () => schedulePlanned().catch((e) => console.error("[planned] échec :", e.message));
  setTimeout(run, 35000);
  setInterval(run, 60 * 60e3);
}
