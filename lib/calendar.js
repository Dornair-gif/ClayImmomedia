import crypto from "node:crypto";

export const TZ = "Europe/Paris";
// dow : 0 dimanche … 6 samedi. Rythme du plan de marketing digital (septembre 2026).
export const RHYTHM = [
  { dow: 1, channel: "linkedin", time: "08:15" },
  { dow: 2, channel: "instagram", time: "18:10" },
  { dow: 3, channel: "google", time: "10:00" },
  { dow: 4, channel: "linkedin", time: "08:15" },
  { dow: 5, channel: "instagram", time: "12:30" },
  { dow: 0, channel: "instagram", time: "10:00" },
];
export const PILLAR_CYCLE = (process.env.PILLAR_CYCLE || "pedagogie,maison,preuve").split(",");
export const ANGLES = ["angle principal", "angle question de client", "angle erreur à éviter", "angle cas concret général"];

// Convertit une date locale Paris (YYYY-MM-DD, HH:MM) en ISO UTC, DST compris.
export function parisToIso(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(guess)).reduce((a, p) => ((a[p.type] = p.value), a), {});
    const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    guess += Date.UTC(y, mo - 1, d, h, mi) - asLocal;
  }
  return new Date(guess).toISOString();
}

const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();

export function plan({ start, weeks, topics, existing = [] }) {
  const usage = {}; // channel|topic -> nombre d'utilisations
  for (const p of existing) usage[`${p.channel}|${p.topicId}`] = (usage[`${p.channel}|${p.topicId}`] || 0) + 1;
  const taken = new Set(existing.map((p) => `${p.date}|${p.channel}`));
  const out = [];
  let slotIndex = existing.length;

  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    for (const slot of RHYTHM.filter((r) => r.dow === dow(date))) {
      if (taken.has(`${date}|${slot.channel}`)) continue;
      const pillar = PILLAR_CYCLE[slotIndex++ % PILLAR_CYCLE.length];
      const pool = (pl) => topics.filter((t) => t.pillar === pl && t.channels.includes(slot.channel));
      let candidates = pool(pillar);
      const score = (t) => usage[`${slot.channel}|${t.id}`] || 0;
      let best = candidates.sort((a, b) => score(a) - score(b))[0];
      let placeholder = false;

      if (pillar === "preuve" && (!best || score(best) >= 1)) {
        // Les ventes réalisées demandent des faits : la carte attend les données de l'agence.
        best = topics.find((t) => t.id === "p25");
        placeholder = true;
      }
      if (!best) best = topics.filter((t) => t.channels.includes(slot.channel)).sort((a, b) => score(a) - score(b))[0];

      const used = usage[`${slot.channel}|${best.id}`] || 0;
      usage[`${slot.channel}|${best.id}`] = used + 1;
      const needsData = !!best.needsData || placeholder;
      out.push({
        id: crypto.randomUUID(),
        date, time: slot.time, dueAt: parisToIso(date, slot.time),
        channel: slot.channel, topicId: best.id, pillar: best.pillar, title: best.title,
        angle: ANGLES[used % ANGLES.length],
        text: "", image: best.portrait ? `PORTRAIT:${best.portrait}` : "", visuel: "",
        status: needsData ? "needs_data" : "planned",
        data: "", lint: { errors: [], warnings: [] }, bufferId: "", error: "", attempts: 0,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return out;
}
