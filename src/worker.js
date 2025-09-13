// src/worker.js
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // Healthcheck
    if (req.method === "GET" && url.pathname === "/") {
      return new Response("jokebot alive");
    }

    // Manual test: proves BOT_ID can post
    // Visit: /test?msg=Hello
    if (req.method === "GET" && url.pathname === "/test") {
      const msg = url.searchParams.get("msg") || "Test OK";
      ctx.waitUntil(postToGroupMe(env.BOT_ID, msg));
      return new Response("sent");
    }

    // Reachability check so you can hit it in a browser
    if (req.method === "GET" && url.pathname === "/webhook") {
      console.log("GET /webhook (reachability check)");
      return new Response("ok");
    }

    // Real GroupMe webhook
    if (req.method === "POST" && url.pathname === "/webhook") {
      const body = await safeJson(req);
      console.log("incoming webhook", { sender_type: body?.sender_type, text: body?.text });

      // Ignore bot/system to avoid loops
      if (body?.sender_type !== "user") return new Response("ok");

      const reply = await buildReply(body);
      if (reply) ctx.waitUntil(postToGroupMe(env.BOT_ID, reply));
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(_evt, env) {
    const joke = await getRandomJoke();
    await postToGroupMe(env.BOT_ID, `Hourly joke time! ${joke}`);
  }
};

// ------- helpers -------

async function buildReply(body) {
  const name = (body?.name || "there").trim();
  const text = (body?.text || "").trim();
  const lower = text.toLowerCase();

  let joke = null;

  if (/\btell me a joke\b/.test(lower) || /\bjoke please\b/.test(lower) || /^joke\b/.test(lower)) {
    joke = await getRandomJoke();
  } else {
    // "joke about X" / "do you have a joke about X"
    const m = lower.match(/(?:joke(?:\s+please)?\s+about|do you have a joke about)\s+(.+)/);
    if (m) {
      const term = m[1].replace(/[?.!]+$/, "").slice(0, 80);
      joke = await searchJoke(term);
    }
  }

  if (!joke) return null;
  return `Hey ${name} — ${joke}`;
}

async function postToGroupMe(botId, text, attachments) {
  if (!botId) { console.log("BOT_ID missing"); return; }
  try {
    const res = await fetch("https://api.groupme.com/v3/bots/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot_id: botId, text, attachments })
    });
    console.log("postToGroupMe status", res.status);
  } catch (err) {
    console.log("postToGroupMe error", String(err));
  }
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
  const r = await fetch(
    `https://icanhazdadjoke.com/search?limit=30&term=${encodeURIComponent(term)}`,
    { headers: { Accept: "application/json", "User-Agent": "groupme-jokebot (workers.dev)" } }
  );
  const d = await r.json().catch(() => ({}));
  if (Array.isArray(d.results) && d.results.length) return pick(d.results).joke;
  return `I don’t have one about “${term}”… but here’s one: ${await getRandomJoke()}`;
}

async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}
