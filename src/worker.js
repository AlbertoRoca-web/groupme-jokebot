// Minimal GroupMe joke bot (request-only)
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") return new Response("jokebot alive");
    if (req.method === "GET" && url.pathname === "/webhook") return new Response("ok");
    if (req.method === "GET" && url.pathname === "/test") {
      ctx.waitUntil(postToGroupMe(env.BOT_ID, "jokebot: /test OK"));
      return new Response("sent");
    }

    if (req.method === "POST" && url.pathname === "/webhook") {
      const raw = await req.text().catch(() => "");
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch {}
      if (body?.sender_type !== "user") return new Response("ok");

      const reply = await buildReply(body);
      if (reply) ctx.waitUntil(postToGroupMe(env.BOT_ID, reply));
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }
};

async function buildReply(body) {
  const name = (body?.name || "there").trim();
  const lower = String(body?.text || "").toLowerCase();

  let joke = null;
  if (/\bjoke please\b/.test(lower) || /\btell me a joke\b/.test(lower) || /^joke\b/.test(lower)) {
    joke = await getRandomJoke();
  } else {
    const m = lower.match(/(?:joke(?:\s+please)?\s+about|do you have a joke about)\s+(.+)/);
    if (m) {
      const term = m[1].replace(/[?.!]+$/, "").slice(0, 80);
      joke = await searchJoke(term);
    }
  }
  return joke ? `Hey ${name} — ${joke}` : null;
}

async function postToGroupMe(botId, text) {
  if (!botId) { console.log("BOT_ID missing"); return; }
  const res = await fetch("https://api.groupme.com/v3/bots/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot_id: botId, text })
  });
  console.log("postToGroupMe", res.status);
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function getRandomJoke() {
  const r = await fetch("https://icanhazdadjoke.com/", {
    headers: { Accept: "application/json", "User-Agent": "groupme-jokebot (workers.dev)" }
  });
  const d = await r.json().catch(() => ({}));
  return d.joke || "Hmm… no joke right now 😅";
}

async function searchJoke(term) {
  const r = await fetch(`https://icanhazdadjoke.com/search?limit=30&term=${encodeURIComponent(term)}`, {
    headers: { Accept: "application/json", "User-Agent": "groupme-jokebot (workers.dev)" }
  });
  const d = await r.json().catch(() => ({}));
  if (Array.isArray(d.results) && d.results.length) return pick(d.results).joke;
  return `I don’t have one about “${term}”… but here’s one: ${await getRandomJoke()}`;
}
