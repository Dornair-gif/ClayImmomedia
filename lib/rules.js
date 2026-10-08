// Contrôle des règles de rédaction ClayImmo. Aucune dépendance.
// errors   : bloquent l'approbation, le moteur régénère une fois puis signale.
// warnings : à relire par un humain, n'empêchent pas l'approbation.

export const LIMITS = { linkedin: 3000, instagram: 2200, google: 1500 };

const AI_PATTERNS = [
  [/il ne s['’]agit (pas|plus) (de|d['’])/i, "tournure « il ne s'agit pas de X mais de Y »"],
  [/ce n['’]est pas [^.!?\n]{1,80}[,;] ?c['’]est/i, "tournure « ce n'est pas X, c'est Y »"],
  [/\b(en résumé|en conclusion|en somme|pour conclure)\b/i, "formule de conclusion creuse"],
  [/\bdans un monde (où|de|en)\b/i, "ouverture « dans un monde où »"],
  [/\b(plongeons|décryptons|explorons|dévoilons)\b/i, "verbe d'annonce typique"],
  [/!{2,}/, "points d'exclamation multiples"],
];

const SUPERLATIVES = /\b(le meilleur|la meilleure|les meilleur(e)?s|numéro un|n°\s?1|leader|incontournable|exceptionnel(le)?s?|unique en son genre|inégalé(e)?s?)\b/i;

export function normNumber(s) {
  return String(s).replace(/[\s  ]/g, "");
}

export function extractNumbers(text, knownPhrases = []) {
  let t = text;
  for (const p of knownPhrases) t = t.split(p).join(" ");
  const out = [];
  const re = /\d+(?:[\s  ]\d{3})*(?:[.,]\d+)?/g;
  let m;
  while ((m = re.exec(t))) out.push(normNumber(m[0]));
  return out;
}

export function lint(text, channel, { allowedNumbers = [], knownPhrases = [] } = {}) {
  const errors = [];
  const warnings = [];
  const t = text || "";

  if (t.trim().length < 60) errors.push("texte trop court");
  const limit = LIMITS[channel];
  if (limit && t.length > limit) errors.push(`texte trop long pour ${channel} (${t.length} sur ${limit})`);

  if (/[—–―]/.test(t)) errors.push("tiret long ou demi-cadratin utilisé comme ponctuation");
  if (/\p{Extended_Pictographic}/u.test(t.replace(/[©®™]/g, ""))) errors.push("emoji présent");

  const re = /viager/gi;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 5), m.index).toLowerCase();
    if (before !== "viva ") { errors.push("le mot « viager » est employé hors de la marque Viva Viager"); break; }
  }

  for (const [rx, label] of AI_PATTERNS) if (rx.test(t)) errors.push(`tournure d'IA : ${label}`);

  if (SUPERLATIVES.test(t)) warnings.push("superlatif sans preuve à justifier ou retirer");

  const triples = (t.match(/[^,.;:\n]{3,40}, [^,.;:\n]{3,40} et [^,.;:\n]{3,40}/g) || []).length;
  if (triples >= 2) warnings.push("plusieurs énumérations de trois éléments");

  if (/#\w+/.test(t)) warnings.push("hashtag présent, à confirmer");

  const allowed = new Set(allowedNumbers.map(normNumber));
  const unknown = [...new Set(extractNumbers(t, knownPhrases).filter((n) => !allowed.has(n)))];
  if (unknown.length) warnings.push(`chiffres à vérifier avant publication : ${unknown.join(", ")}`);

  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim().length).filter((n) => n > 0);
  if (sentences.length >= 5) {
    const mean = sentences.reduce((a, b) => a + b, 0) / sentences.length;
    const sd = Math.sqrt(sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / sentences.length);
    if (sd / mean < 0.25) warnings.push("phrases de longueur très régulière, rythme à varier");
  }

  return { errors, warnings };
}
