export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/webhook") {
      const body = await req.json().catch(() => ({}));
      if (body.sender_type !== "user") return new Response("ok");

      const text = (body.text || "").trim();
      const lower = text.toLowerCase();
      const name = body.name || "there";

      let reply = null;
      if (/\bjoke please\b/.test(lower) || /^joke\b/.test(lower)) {
        reply = await getRandomJoke();
      } else {
        const m = lower.match(/(?:joke(?:\s+please)?\s+about|do you have a joke about)\s+(.+)/);
        if (m) reply = await searchJoke(m[1].replace(/[?.!]+$/, "").slice(0, 80));
      }

      if (reply) await postToGroupMe(env.BOT_ID, `Hey ${name} — ${reply}`);
      return new Response("ok");
    }
    return new Response("jokebot alive");
  },

  async scheduled(_evt, env) {
    const joke = await getRandomJoke();
    await postToGroupMe(env.BOT_ID, `Hourly joke time! ${joke}`);
  }
};

async function postToGroupMe(botId, text, attachments) {
  await fetch("https://api.groupme.com/v3/bots/post", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ bot_id: botId, text, attachments })
  });
}

function pick(a){ return a[Math.floor(Math.random()*a.length)]; }

async function getRandomJoke(){
  const r = await fetch("https://icanhazdadjoke.com/", {
    headers: {"Accept":"application/json","User-Agent":"groupme-jokebot"}
  });
  const d = await r.json();
  return d.joke;
}

async function searchJoke(term){
  const r = await fetch(`https://icanhazdadjoke.com/search?limit=30&term=${encodeURIComponent(term)}`, {
    headers: {"Accept":"application/json","User-Agent":"groupme-jokebot"}
  });
  const d = await r.json();
  if (d.results?.length) return pick(d.results).joke;
  return `I don’t have one about “${term}”… but here’s one: ${await getRandomJoke()}`;
}
