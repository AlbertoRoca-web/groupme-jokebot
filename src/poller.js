// Request-only GroupMe joke bot (polling via GitHub Actions).
// Replies ONLY to: "joke please", "tell me a joke", "joke", or "joke about <term>".

const GROUPME_TOKEN = process.env.GROUPME_TOKEN;
const GROUP_ID = process.env.GROUP_ID;
const BOT_ID = process.env.BOT_ID;

if (!GROUPME_TOKEN || !GROUP_ID || !BOT_ID) {
  console.error("Missing env: GROUPME_TOKEN / GROUP_ID / BOT_ID");
  process.exit(1);
}

try {
  await runOnce();
} catch (e) {
  console.error("runOnce error:", e);
  process.exitCode = 1;
}

async function runOnce() {
  const msgs = await getLatestMessages(100);
  if (!Array.isArray(msgs) || msgs.length === 0) return;

  // dedupe: if we already replied to a message id (tagged as ref:<id>), skip it
  const replied = new Set();
  for (const m of msgs) {
    if (m.sender_type === "bot" && typeof m.text === "string") {
      const r = m.text.match(/ref:([0-9]+)/);
      if (r) replied.add(r[1]);
    }
  }

  // process oldest->newest so conversations read naturally
  let replies = 0;
  for (const m of msgs.slice().reverse()) {
    if (m.sender_type !== "user") continue;
    if (!m.text) continue;
    if (replied.has(m.id)) continue;

    const reply = await buildReply(m);
    if (!reply) continue;             // <-- REQUEST-ONLY: no trigger -> no reply

    const ok = await postBotMessage(`${reply} (ref:${m.id})`);
    if (ok) {
      replies++;
      replied.add(m.id);
      await sleep(400);
    }
    if (replies >= 5) break;          // soft cap per run
  }

  console.log(`Replied to ${replies} message(s).`);
}

// ---------- GroupMe API ----------

// GET /v3/groups/:group_id/messages?limit=...
async function getLatestMessages(limit = 20) {
  const url = new URL(`https://api.groupme.com/v3/groups/${GROUP_ID}/messages`);
  url.searchParams.set("limit", String(Math.min(100, Math.max(1, limit))));
  const res = await fetch(url, {
    headers: { "X-Access-Token": GROUPME_TOKEN, "Accept": "application/json" }
  });
  if (!res.ok) {
    console.error("getLatestMessages", res.status, await safeText(res));
    return [];
  }
  const data = await res.json().catch(() => ({}));
  return data?.response?.messages ?? [];
}

// POST /v3/bots/post  { bot_id, text }
async function postBotMessage(text) {
  const res = await fetch("https://api.groupme.com/v3/bots/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot_id: BOT_ID, text })
  });
  if (!res.ok) {
    console.error("postBotMessage", res.status, await safeText(res));
    return false;
  }
  return true;
}

// ---------- Joke logic (request-only) ----------

async function buildReply(msg) {
  const name = (msg.name || "there").trim();
  const lower = (msg.text || "").toLowerCase().trim();

  if (/\bjoke please\b/.test(lower) || /\btell me a joke\b/.test(lower) || /^joke\b/.test(lower)) {
    return `Hey ${name} — ${await getRandomJoke()}`;
  }

  const m = lower.match(/(?:joke(?:\s+please)?\s+about|do you have a joke about)\s+(.+)/);
  if (m) {
    const term = m[1].replace(/[?.!]+$/, "").slice(0, 80);
    return `Hey ${name} — ${await searchJoke(term)}`;
  }

  return null; // <-- no trigger, no reply
}

async function getRandomJoke() {
  const r = await fetch("https://icanhazdadjoke.com/", {
    headers: { "Accept": "application/json", "User-Agent": "groupme-jokebot (github-actions)" }
  });
  const d = await r.json().catch(() => ({}));
  return d?.joke || "Hmm… no joke right now 😅";
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function searchJoke(term) {
  const r = await fetch(`https://icanhazdadjoke.com/search?limit=30&term=${encodeURIComponent(term)}`, {
    headers: { "Accept": "application/json", "User-Agent": "groupme-jokebot (github-actions)" }
  });
  const d = await r.json().catch(() => ({}));
  if (Array.isArray(d.results) && d.results.length) return pick(d.results).joke;
  return `I don’t have one about “${term}”… but here’s one: ${await getRandomJoke()}`;
}

// ---------- utils ----------
async function safeText(res) { try { return await res.text(); } catch { return ""; } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
