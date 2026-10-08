import fs from "node:fs";
import { lint, LIMITS } from "./rules.js";
import { getPost, putPost, get, setJob, listPosts } from "./store.js";

const facts = JSON.parse(fs.readFileSync(new URL("../data/facts.json", import.meta.url), "utf8"));
const topics = JSON.parse(fs.readFileSync(new URL("../data/topics.json", import.meta.url), "utf8")).topics;
export const TOPICS = topics;
export const FACTS = facts;

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const confirmed = facts.facts.filter((f) => f.status === "confirmed");
const unconfirmed = facts.facts.filter((f) => f.status !== "confirmed");

export const PORTRAITS = {
  reza: "https://www.clayimmo.com/wp-content/uploads/2026/09/clayimmo-equipe-reza.jpg",
  jeanjean: "https://www.clayimmo.com/wp-content/uploads/2026/09/clayimmo-equipe-jeanjean.jpg",
  pascale: "https://www.clayimmo.com/wp-content/uploads/2026/09/clayimmo-equipe-pascale.jpg",
  emilie: "https://www.clayimmo.com/wp-content/uploads/2026/09/clayimmo-equipe-emilie.jpg",
  romain: "https://www.clayimmo.com/wp-content/uploads/2026/09/clayimmo-equipe-romain.jpg",
  sophie: "https://www.clayimmo.com/wp-content/uploads/2026/09/clayimmo-equipe-sophie.jpg",
  krysta: "https://www.clayimmo.com/wp-content/uploads/2026/09/clayimmo-equipe-krysta.jpg",
  michel: "https://www.clayimmo.com/wp-content/uploads/2026/10/clayimmo-equipe-michel-hd.jpg",
};

export function resolveImage(img) {
  if (!img) return "";
  if (img.startsWith("PORTRAIT:")) return PORTRAITS[img.slice(9)] || "";
  return img;
}

const CHANNEL_SPEC = {
  linkedin: "LinkedIn : entre 700 et 1500 caractères, paragraphes courts, première ligne concrète qui donne envie de lire la suite, aucun hashtag. Terminer sur une phrase simple, avec l'agence nommée seulement si cela sert le propos.",
  instagram: "Instagram : entre 300 et 800 caractères, une seule idée, ton direct, aucun hashtag. Fournir aussi une idée de visuel d'une phrase, avec de vraies personnes ou de vrais lieux, jamais d'avatar ni d'image générée.",
  google: "Publication de fiche Google : entre 250 et 700 caractères, utile et factuelle, une première phrase qui dit de quoi il s'agit, puis ce que le lecteur peut faire (estimation gratuite, appel au 01 45 51 62 13). Aucun emoji.",
};

export function buildSystem() {
  return `Tu rédiges les publications de ClayImmo, agence immobilière indépendante de Paris 6e, pour les réseaux sociaux et la fiche Google. Tu écris en français, à la première personne du pluriel, avec la sobriété d'une maison qui préfère montrer ce qu'elle a signé plutôt que d'affirmer qu'elle est la meilleure.

RÈGLES ABSOLUES
1. Aucun tiret long ni demi-cadratin. Utilise virgule, deux-points, point-virgule, parenthèse ou deux phrases.
2. Aucun emoji. Aucun hashtag.
3. Le mot « viager » n'apparaît que dans le nom « Viva Viager ». Pour le sujet, dis « démembrement » ou « nue-propriété ».
4. Aucun chiffre, pourcentage, prix, délai légal, barème, date, nom de personne ou de lieu qui ne figure pas dans les FAITS CONFIRMÉS, dans le sujet ou dans les DONNÉES FOURNIES. Si un chiffre manque, écris sans chiffre.
5. Jamais d'affirmation fiscale ou juridique précise. Reste général et renvoie au notaire ou au conseil de l'agence.
6. Pas de tournure d'IA : jamais « il ne s'agit pas de X mais de Y », « ce n'est pas X, c'est Y », « en résumé », « en conclusion », « dans un monde où », pas d'énumérations de trois éléments à chaque paragraphe, pas de superlatif sans preuve, pas de phrases toutes de même longueur. Alterne des phrases courtes et plus longues, assume un point de vue.
7. Aucune citation de client sauf si elle est fournie mot pour mot dans les DONNÉES FOURNIES.
8. Ne mentionne jamais « depuis 2012 », « quatorze ans » ni aucune promesse de délai de réponse : ces points ne sont pas confirmés.

FAITS CONFIRMÉS
${confirmed.map((f) => `- ${f.text}`).join("\n")}

POINTS NON CONFIRMÉS, À NE JAMAIS UTILISER
${unconfirmed.map((f) => `- ${f.text}`).join("\n")}

FORMAT DE RÉPONSE : un seul objet JSON, sans texte autour : {"text": "...", "visuel": "..."}. Le champ visuel est une idée de visuel en une phrase (vide pour Google).`;
}

export function buildUser(post, topic, recent) {
  return `Canal : ${CHANNEL_SPEC[post.channel]}
Registre éditorial : ${post.pillar}
Sujet : ${topic.title}
Consigne : ${topic.brief}
Angle à prendre : ${post.angle}
${post.data ? `DONNÉES FOURNIES PAR L'AGENCE (seule matière factuelle autorisée en plus des faits confirmés) :\n${post.data}\n` : ""}${recent.length ? `Débuts de publications récentes sur ce canal, à ne pas répéter :\n${recent.map((r) => `- ${r}`).join("\n")}\n` : ""}Rédige la publication.`;
}

export function allowedNumbersFor(post, topic) {
  const nums = [];
  for (const f of confirmed) nums.push(...(f.numbers || []));
  nums.push(...facts.global_numbers);
  for (const s of [topic.title, topic.brief, post.data || ""]) nums.push(...(s.match(/\d+(?:[.,]\d+)?/g) || []));
  return nums;
}

function parseJson(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("réponse sans JSON");
  const o = JSON.parse(m[0]);
  if (typeof o.text !== "string") throw new Error("champ text manquant");
  return { text: o.text.trim(), visuel: (o.visuel || "").trim() };
}

export async function callModel(system, user, fetchImpl = fetch) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY manquante");
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL(), max_tokens: 1400, system, messages: [{ role: "user", content: user }] }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`Anthropic ${r.status} : ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return j.content.map((c) => c.text || "").join("");
  }
  throw new Error("Anthropic indisponible après trois essais");
}

export async function generatePost(id, { fetchImpl = fetch } = {}) {
  const post = getPost(id);
  if (!post) throw new Error("publication introuvable");
  const topic = topics.find((t) => t.id === post.topicId);
  if (post.status === "needs_data" && !post.data.trim()) throw new Error("données de l'agence à renseigner avant rédaction");
  const recent = listPosts().filter((p) => p.channel === post.channel && p.text && p.id !== id).slice(-6).map((p) => p.text.slice(0, 70));

  const opts = { allowedNumbers: allowedNumbersFor(post, topic), knownPhrases: ["01 45 51 62 13"] };
  let user = buildUser(post, topic, recent);
  let result, report;
  for (let round = 0; round < 2; round++) {
    result = parseJson(await callModel(buildSystem(), user, fetchImpl));
    report = lint(result.text, post.channel, opts);
    if (!report.errors.length) break;
    user += `\n\nTa version précédente enfreint ces règles : ${report.errors.join(" ; ")}. Réécris-la entièrement en les respectant.`;
  }
  post.text = result.text;
  post.visuel = result.visuel;
  post.lint = report;
  post.attempts = (post.attempts || 0) + 1;
  post.status = report.errors.length ? "needs_edit" : "drafted";
  post.error = "";
  return putPost(post);
}

let running = false;
export async function generateBatch(ids, opts = {}) {
  if (running) throw new Error("une rédaction par lot est déjà en cours");
  running = true;
  const job = { startedAt: new Date().toISOString(), total: ids.length, done: 0, failed: [], running: true };
  setJob(job);
  try {
    for (const id of ids) {
      try { await generatePost(id, opts); }
      catch (e) { job.failed.push({ id, error: String(e.message || e) }); }
      job.done++;
      setJob(job);
      await new Promise((s) => setTimeout(s, opts.pauseMs ?? 400));
    }
  } finally {
    job.running = false; job.finishedAt = new Date().toISOString(); setJob(job); running = false;
  }
  return job;
}

export { CHANNEL_SPEC, LIMITS };
