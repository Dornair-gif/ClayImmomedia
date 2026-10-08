import { listPosts, putPost } from "./store.js";
import { hasToken, discoverChannels, sendPost } from "./buffer.js";
import { resolveImage } from "./generate.js";

let channelCache = null;
let busy = false;
export const maxQueue = () => Number(process.env.BUFFER_MAX_QUEUE || 8);

async function channels(fetchImpl) {
  const env = {
    linkedin: process.env.BUFFER_CHANNEL_LINKEDIN, instagram: process.env.BUFFER_CHANNEL_INSTAGRAM, google: process.env.BUFFER_CHANNEL_GOOGLE,
  };
  if (env.linkedin && env.instagram && env.google) return env;
  if (!channelCache) channelCache = (await discoverChannels(fetchImpl)).found;
  return { ...channelCache, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v)) };
}

export async function feed({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (busy) return { skipped: true, log: ["Synchronisation déjà en cours."] };
  busy = true;
  const log = [];
  try {
    // Les publications dont l'échéance est passée ne sont plus en attente chez Buffer.
    for (const p of listPosts()) {
      if (p.status === "queued" && Date.parse(p.dueAt) < now - 2 * 3600e3) { p.status = "passed"; putPost(p); }
    }
    const queued = listPosts().filter((p) => p.status === "queued" && Date.parse(p.dueAt) > now).length;
    let slots = maxQueue() - queued;
    const ready = listPosts().filter((p) => p.status === "approved" && Date.parse(p.dueAt) > now + 15 * 60e3);

    if (!hasToken()) {
      return { dry: true, queued, log: [`Clé Buffer absente : simulation. ${ready.length} publication(s) approuvée(s) attendent la clé.`] };
    }
    const ch = await channels(fetchImpl);
    for (const p of ready) {
      if (slots <= 0) { log.push(`File Buffer pleine (${maxQueue()} en attente).`); break; }
      if (!ch[p.channel]) { p.status = "error"; p.error = `canal ${p.channel} introuvable dans Buffer`; putPost(p); continue; }
      if (p.channel === "instagram" && !resolveImage(p.image)) { p.status = "error"; p.error = "Instagram exige une image"; putPost(p); continue; }
      try {
        const sent = await sendPost(p, ch[p.channel], fetchImpl);
        p.status = "queued"; p.bufferId = sent.id; p.error = ""; putPost(p); slots--;
        log.push(`Programmée : ${p.date} ${p.channel} ${p.title}`);
      } catch (e) {
        const msg = String(e.message || e);
        if (/limit|queue|full|plein|maximum/i.test(msg)) { log.push(`Buffer refuse : ${msg}`); break; }
        p.status = "error"; p.error = msg; putPost(p); log.push(`Erreur : ${p.title} : ${msg}`);
      }
    }
    return { dry: false, queued: maxQueue() - slots, log };
  } finally { busy = false; }
}
