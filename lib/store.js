import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "var");
const FILE = path.join(DATA_DIR, "state.json");

let state = { posts: {}, meta: { createdAt: new Date().toISOString() }, job: null };

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) state = JSON.parse(fs.readFileSync(FILE, "utf8"));
  return state;
}

export function save() {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE);
}

export const get = () => state;
export const getPost = (id) => state.posts[id];

export function putPost(p) {
  p.updatedAt = new Date().toISOString();
  state.posts[p.id] = p;
  save();
  return p;
}

export function listPosts() {
  return Object.values(state.posts).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export function setJob(job) { state.job = job; save(); }
export function _reset(s) { state = s; }
