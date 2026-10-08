import { test } from "node:test";
import assert from "node:assert/strict";
import { lint, extractNumbers } from "../lib/rules.js";
import { plan, parisToIso } from "../lib/calendar.js";
import { TOPICS } from "../lib/generate.js";
import { buildInput } from "../lib/buffer.js";

const long = "Nous avons vendu cet appartement après avoir reçu plusieurs acquéreurs qui connaissaient déjà la rue. Chaque visite a été préparée avec le vendeur.";

test("accepte un texte propre", () => {
  const r = lint(long, "linkedin");
  assert.deepEqual(r.errors, []);
});
test("refuse tiret long, demi-cadratin et emoji", () => {
  assert.ok(lint(long + " — oui", "linkedin").errors.some((e) => e.includes("tiret")));
  assert.ok(lint(long + " – oui", "linkedin").errors.some((e) => e.includes("tiret")));
  assert.ok(lint(long + " 🏠", "linkedin").errors.some((e) => e.includes("emoji")));
});
test("viager n'est permis que dans Viva Viager", () => {
  assert.ok(lint(long + " Le viager est un contrat.", "linkedin").errors.some((e) => e.includes("viager")));
  assert.deepEqual(lint(long + " Notre société sœur Viva Viager conseille.", "linkedin").errors, []);
});
test("repère les tournures d'IA", () => {
  assert.ok(lint(long + " Il ne s'agit pas de vendre mais de conseiller.", "linkedin").errors.length);
  assert.ok(lint(long + " Ce n'est pas un bien, c'est un projet.", "linkedin").errors.length);
  assert.ok(lint(long + " En conclusion, appelez-nous.", "linkedin").errors.length);
});
test("signale les chiffres inconnus mais pas les chiffres autorisés", () => {
  const r = lint(long + " Le prix a baissé de 12 % en 3 mois.", "linkedin", { allowedNumbers: ["12"] });
  assert.ok(r.warnings.some((w) => w.includes("3")));
  assert.ok(!r.warnings.some((w) => w.includes("12,")));
  const tel = lint(long + " Appelez le 01 45 51 62 13.", "linkedin", { knownPhrases: ["01 45 51 62 13"] });
  assert.ok(!tel.warnings.some((w) => w.includes("chiffres")));
});
test("limite de longueur par canal", () => {
  assert.ok(lint("a".repeat(1600), "google").errors.some((e) => e.includes("trop long")));
});
test("extractNumbers gère les milliers et les décimales", () => {
  assert.deepEqual(extractNumbers("4,9 sur 10, soit 1 200 euros"), ["4,9", "10", "1200"]);
});
test("heure de Paris : été et hiver", () => {
  assert.equal(parisToIso("2026-07-01", "10:00"), "2026-07-01T08:00:00.000Z");
  assert.equal(parisToIso("2026-12-01", "10:00"), "2026-12-01T09:00:00.000Z");
  assert.equal(parisToIso("2026-10-25", "10:00"), "2026-10-25T09:00:00.000Z"); // fin d'heure d'été
});
test("planification : 26 semaines, 6 par semaine, équilibre des registres", () => {
  const posts = plan({ start: "2026-10-12", weeks: 26, topics: TOPICS });
  assert.equal(posts.length, 26 * 6);
  const by = (k) => posts.filter((p) => p.channel === k).length;
  assert.equal(by("linkedin"), 52); assert.equal(by("instagram"), 78); assert.equal(by("google"), 26);
  const pil = (k) => posts.filter((p) => p.pillar === k).length;
  assert.ok(Math.abs(pil("pedagogie") - pil("maison")) <= 3);
  for (const p of posts) assert.ok(TOPICS.find((t) => t.id === p.topicId).channels.includes(p.channel) || p.topicId === "p25");
  assert.ok(new Set(posts.map((p) => `${p.date}|${p.channel}`)).size === posts.length, "pas de doublon de créneau");
});
test("replanifier n'écrase rien", () => {
  const a = plan({ start: "2026-10-12", weeks: 4, topics: TOPICS });
  const b = plan({ start: "2026-10-12", weeks: 4, topics: TOPICS, existing: a });
  assert.equal(b.length, 0);
});
test("requête Buffer conforme au schéma", () => {
  const ig = buildInput({ channel: "instagram", text: "x", dueAt: "2026-10-12T08:00:00.000Z", image: "PORTRAIT:pascale", title: "t" }, "c1");
  assert.equal(ig.mode, "customScheduled"); assert.equal(ig.needsApproval, false);
  assert.equal(ig.metadata.instagram.type, "post"); assert.ok(ig.assets[0].image.url.endsWith("pascale.jpg"));
  const g = buildInput({ channel: "google", text: "x", dueAt: "z", image: "", title: "t" }, "c2");
  assert.equal(g.metadata.google.type, "whats_new"); assert.deepEqual(g.assets, []);
});
