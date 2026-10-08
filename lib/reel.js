// Publication ponctuelle du reel de lancement (Instagram) et de sa version large (LinkedIn).
// Déclenchée une seule fois au démarrage si REEL_PUBLISH=go, après contrôle des canaux et des liens vidéo.
import fs from "node:fs";
import path from "node:path";
import { gql, discoverChannels } from "./buffer.js";

const DATA = process.env.DATA_DIR || "./data";
const FLAG = path.join(DATA, "reel-lancement.json");
const base = () => (process.env.PUBLIC_URL || "").replace(/\/$/, "");

const TXT_INSTAGRAM = `Deux dates : le premier rendez-vous, la signature.
Entre les deux, tout se joue.

Chez ClayImmo, un interlocuteur qui répond, un bien préparé comme on prépare une édition, des visites soignées.

Le nouveau site est en ligne : nos biens à vendre, nos ventes, l'équipe, et une estimation gratuite et sans engagement.

Lien en bio, ou sur clayimmo.com
6 rue Stanislas, Paris 6e · 01 45 51 62 13

#ClayImmo #ImmobilierAutrement #ImmobilierParis #AgenceImmobilière #AgenceIndépendante #Paris6 #VendreÀParis #EstimationGratuite #ExpertImmobilier #BiensDeParis`;

const TXT_LINKEDIN = `Vendre un bien à Paris tient en deux dates : le premier rendez-vous, et la signature.
Ce qui fait la différence se joue entre les deux.

Chez ClayImmo, nous sommes indépendants par conviction : peu de mandats à la fois, un interlocuteur que vous avez au bout du fil, un bien préparé comme on prépare une édition.

Notre nouveau site est en ligne : biens à vendre, ventes réalisées, équipe, et une estimation gratuite et sans engagement.

À découvrir sur clayimmo.com

Et pour vous, qu'est-ce qui compte le plus entre le premier rendez-vous et la signature ?

#ImmobilierParis #ClayImmo #ImmobilierAutrement #AgenceIndépendante`;

const CREATE = `mutation($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id dueAt } }
    ... on MutationError { message }
  }
}`;

const log = (...a) => console.log("[reel]", ...a);
const readFlag = () => { try { return JSON.parse(fs.readFileSync(FLAG, "utf8")); } catch { return {}; } };
const writeFlag = (o) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FLAG, JSON.stringify(o, null, 2)); };

async function reachable(url) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    const len = Number(r.headers.get("content-length") || 0);
    log("contrôle", url, r.status, r.headers.get("content-type"), len);
    return r.ok && len > 100000;
  } catch (e) { log("contrôle KO", url, e.message); return false; }
}

async function tryPost(label, channelId, text, videoUrl, thumbUrl, metadata) {
  const shapes = [
    [{ video: { url: videoUrl, thumbnailUrl: thumbUrl } }],
    [{ video: { url: videoUrl } }],
    [{ videos: [{ url: videoUrl }] }],
  ];
  for (const assets of shapes) {
    const input = { channelId, text, schedulingType: "automatic", mode: "shareNow", needsApproval: false, assets };
    if (metadata) input.metadata = metadata;
    try {
      const d = await gql(CREATE, { input });
      const r = d.createPost;
      if (r.__typename === "MutationError" || r.message) { log(label, "refus", r.message); continue; }
      log(label, "OK", JSON.stringify(r.post));
      return r.post;
    } catch (e) { log(label, "erreur", e.message); }
  }
  return null;
}

export async function publishReel() {
  if (process.env.REEL_PUBLISH !== "go") return;
  const done = readFlag();
  if (done.instagram && done.linkedin) { log("déjà publié", JSON.stringify(done)); return; }
  if (!process.env.BUFFER_TOKEN_CLAYIMMO || !base()) { log("clé Buffer ou PUBLIC_URL manquant"); return; }
  const { all } = await discoverChannels();
  log("canaux", JSON.stringify(all.map((c) => [c.name, c.service, c.organization, c.isDisconnected])));
  const pick = (svc, re) => all.find((c) => String(c.service).toLowerCase().includes(svc) && re.test(c.name) && !c.isDisconnected);
  const ig = pick("instagram", /clay/i);
  const li = pick("linkedin", /clay/i);
  if (!ig && !li) { log("aucun canal ClayImmo trouvé : arrêt, rien publié"); return; }

  if (ig && !done.instagram) {
    const v = `${base()}/media/reel-9x16.mp4`, t = `${base()}/media/reel-9x16.jpg`;
    if (await reachable(v)) {
      const p = await tryPost("instagram", ig.id, TXT_INSTAGRAM, v, t, { instagram: { type: "reel", shouldShareToFeed: true } });
      if (p) { done.instagram = p; writeFlag(done); }
    }
  }
  if (li && !done.linkedin) {
    const v = `${base()}/media/large-16x9.mp4`, t = `${base()}/media/large-16x9.jpg`;
    if (await reachable(v)) {
      const p = await tryPost("linkedin", li.id, TXT_LINKEDIN, v, t, null);
      if (p) { done.linkedin = p; writeFlag(done); }
    }
  }
  log("fin", JSON.stringify(done));
}
