// Minimal GroupMe joke bot (request-only; no cron)
// Replies to: "joke please", "tell me a joke", or "joke about <term>"

let RECENT = []; // tiny in-memory ring buffer for quick debugging

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // Healthcheck
    if (req.method === "GET" && url.pathname === "/") {
      return new Response("jokebot alive");
    }

    // Manual "send a message" test (proves BOT_ID -> GroupMe path)
    // Visit: /test?msg=Hello
    if (req.method === "GET" && url.pathname === "/test") {
      const msg = url.searchParams.get("msg") || "Test OK";
      ctx.waitUntil(postToGroupMe(env.BOT_ID, msg));
      return new Response("sent");
    }

    // View the last few webhook events Cloudflare received (for debugging)
    if (req.method === "GET" && url.pathname === "/recent") {
      return json(RECENT.slice(-10));
    }

    // Real GroupMe webhook
    if (req.method === "POST" && url.pathname === "/webhook") {
      // Read raw once; parse flexibly (JSON OR form-encoded), then log a compact record
      const raw = await req.text().catch(() => "");
      const body = parseBodyFromRaw(raw, req.headers.get("content-type"));

      RECENT.push({
        t: new Date().toISOString(),
        st: body?.sender_type,
        name: body?.name,
        text: body?.text
      });
      if (RECENT.length > 50) RECENT = RECENT.slice(-50);

      // Ignore bot/system/calendar so we don't loop
      if (body?.sender_type && body.sender_type !== "user") {
        console.log("IGNORED sender_type:", body.sender_type);
        return new Response("ok");
      }

      const reply = await buildReply(body);
      if (reply) {
        // Ack immediately; post back asynchronously
        ctx.waitUntil(postToGroupMe(env.BOT_ID, reply));
      }
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }
};

// ---------- helpers ----------

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function parseBodyFromRaw(raw, ct = "") {
  try {
    if ((ct || "").includes("application/json")) return JSON.parse(raw || "{}");
    if ((ct || "").includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(raw || ""));
    }
    // Fallback: try JSON anyway
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

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
  // icanhazdadjoke: no auth; must send Accept: application/json
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
