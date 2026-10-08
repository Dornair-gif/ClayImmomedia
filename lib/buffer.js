import { resolveImage } from "./generate.js";

const ENDPOINT = "https://api.buffer.com";
const SITE = process.env.SITE_URL || "https://www.clayimmo.com";

export const hasToken = () => !!process.env.BUFFER_TOKEN_CLAYIMMO;

export async function gql(query, variables = {}, fetchImpl = fetch) {
  const r = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.BUFFER_TOKEN_CLAYIMMO}` },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error(`Buffer ${r.status} : ${JSON.stringify(j.errors || j).slice(0, 300)}`);
  return j.data;
}

// Retrouve l'identifiant de chaque canal ClayImmo à partir de la clé API.
export async function discoverChannels(fetchImpl = fetch) {
  const acc = await gql("query { account { organizations { id name } } }", {}, fetchImpl);
  const found = {};
  const all = [];
  for (const org of acc.account.organizations) {
    const data = await gql(
      "query($i: ChannelsInput!) { channels(input: $i) { id name service isDisconnected } }",
      { i: { organizationId: org.id } }, fetchImpl);
    for (const c of data.channels) {
      all.push({ ...c, organization: org.name });
      const s = String(c.service).toLowerCase();
      if (s.includes("linkedin")) found.linkedin = c.id;
      else if (s.includes("instagram")) found.instagram = c.id;
      else if (s.includes("google")) found.google = c.id;
    }
  }
  return { found, all };
}

const CREATE = `mutation($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id dueAt } }
    ... on MutationError { message }
  }
}`;

export function buildInput(post, channelId) {
  const input = {
    channelId, text: post.text, schedulingType: "automatic",
    mode: "customScheduled", dueAt: post.dueAt, needsApproval: false, assets: [],
  };
  const img = resolveImage(post.image);
  if (post.channel === "instagram") {
    input.assets = [{ image: { url: img, metadata: { altText: post.visuel || post.title } } }];
    input.metadata = { instagram: { type: "post", shouldShareToFeed: true } };
  } else if (post.channel === "linkedin" && img) {
    input.assets = [{ image: { url: img, metadata: { altText: post.visuel || post.title } } }];
  } else if (post.channel === "google") {
    input.metadata = { google: { type: "whats_new", detailsWhatsNew: { button: "learn_more", link: `${SITE}/vendre/` } } };
    if (img) input.assets = [{ image: { url: img, metadata: { altText: post.visuel || post.title } } }];
  }
  return input;
}

export async function sendPost(post, channelId, fetchImpl = fetch) {
  const data = await gql(CREATE, { input: buildInput(post, channelId) }, fetchImpl);
  const r = data.createPost;
  if (r.__typename === "MutationError" || r.message) throw new Error(r.message || "refus de Buffer");
  return r.post;
}
