// Programmation ponctuelle des reels listés dans planned/*.json sur le compte Instagram ClayImmo.
// Idempotent : chaque reel programmé est noté dans DATA_DIR/planned-done.json et n'est jamais renvoyé.
import fs from "node:fs";
import path from "node:path";
import { gql, discoverChannels } from "./buffer.js";

const DATA = process.env.DATA_DIR || "./data";
const DONE = path.join(DATA, "planned-done.json");
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

export async function schedulePlanned() {
  if (!process.env.BUFFER_TOKEN_CLAYIMMO || !base()) { log("clé Buffer ou PUBLIC_URL manquant"); return; }
  const dir = new URL("../planned/", import.meta.url);
  if (!fs.existsSync(dir)) return;
  const done = readDone();
  const { all } = await discoverChannels();
  const ig = all.find((c) => String(c.service).toLowerCase().includes("instagram") && /clay/i.test(c.name) && !c.isDisconnected);
  if (!ig) { log("canal Instagram ClayImmo introuvable", JSON.stringify(all.map((c) => [c.name, c.service]))); return; }
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const plan = JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
    for (const it of plan.items) {
      if (done[it.key]) { log("déjà programmé", it.key, done[it.key].id); continue; }
      if (Date.parse(it.dueAt) < Date.now() + 30 * 60e3) { log("date passée, ignoré", it.key); continue; }
      const url = `${base()}/media/${it.video}`;
      const input = {
        channelId: ig.id, text: it.text, schedulingType: "automatic", mode: "customScheduled", dueAt: it.dueAt,
        assets: [{ video: { url, metadata: { thumbnailOffset: plan.thumbnailOffsetMs ?? 300 } } }],
        metadata: { instagram: { type: "reel", shouldShareToFeed: true } },
      };
      try {
        const r = (await gql(CREATE, { input })).createPost;
        if (r.__typename === "MutationError" || r.message) { log("refus", it.key, r.message); continue; }
        done[it.key] = r.post; writeDone(done); log("OK", it.key, JSON.stringify(r.post));
      } catch (e) { log("erreur", it.key, e.message); }
    }
  }
}
