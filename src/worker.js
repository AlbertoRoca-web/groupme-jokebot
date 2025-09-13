// src/worker.js — minimal GroupMe joke bot (request-only, no cron)
// Replies to: "joke please", "tell me a joke", "joke about <term>"

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // Healthcheck
    if (req.method === "GET" && url.pathname === "/") {
      return new Response("jokebot alive");
    }

    // Manual post test (proves BOT_ID -> GroupMe works)
    // Visit: /test?msg=Hello
    if (req.method === "GET" && url.pathname === "/test") {
      const msg = url.searchParams.get("msg") || "Test OK";
      ctx.waitUntil(postToGroupMe(env.BOT_ID, msg));
      return new Response("sent");
    }

    // Real GroupMe webhook
    if (url.pathname === "/webhook" && req.method === "POST") {
      // Log raw body so you can see activity in Workers -> Logs (Invocations)
      const raw = await req.text().catch(() => "");
      console.log("WEBHOOK RAW:", raw);

      // Parse JSON if possible
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch {}

      // Avoid loops: ignore messages sent by bots/system/calendar
      if (body?.sender_type && body.sender_type !== "user") {
        console.log("IGNORED (sender_type !== user):", body?.sender_type);
        return new Response("ok");
      }

      const reply = await buildReply(body);
      if (reply) {
        // Reply asynchronously so we ack the webhook immediately
        ctx.waitUntil(postToGroupMe(env.BOT_ID, reply));
      }
      return new Response("ok");
    }

    // Optional reachability ping
    if (url.pathname === "/webhook" && req.method === "GET") {
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }
};

// ---------- helpers ----------

async function buildReply(body) {
  const name = (body?.name || "there").trim();
  const text = (body?.text || "").trim();
  const lower = text.toLowerCase();

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
  // icanhazdadjoke requires Accept: application/json (no auth required)
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
