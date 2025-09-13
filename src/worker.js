// Diagnostic echo bot: proves webhook -> Worker -> GroupMe round-trip
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // health
    if (req.method === "GET" && url.pathname === "/") {
      return new Response("diag alive");
    }

    // manual outbound test (proves BOT_ID can post to GroupMe)
    if (req.method === "GET" && url.pathname === "/test") {
      ctx.waitUntil(postToGroupMe(env.BOT_ID, "diag: /test OK"));
      return new Response("sent");
    }

    // optional reachability check
    if (req.method === "GET" && url.pathname === "/webhook") {
      return new Response("ok");
    }

    // real webhook
    if (req.method === "POST" && url.pathname === "/webhook") {
      const raw = await req.text().catch(() => "");
      console.log("WEBHOOK RAW:", raw);

      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch {}

      const senderType = body?.sender_type || "unknown";
      const text = String(body?.text || "");
      console.log("PARSED:", { senderType, text });

      // Avoid loops: only reply to real users
      if (senderType !== "user") return new Response("ok");

      const reply = `diag: got “${text.slice(0, 60)}”`;
      ctx.waitUntil(postToGroupMe(env.BOT_ID, reply));
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }
};

async function postToGroupMe(botId, text) {
  if (!botId) { console.log("BOT_ID missing"); return; }
  const res = await fetch("https://api.groupme.com/v3/bots/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot_id: botId, text })
  });
  console.log("postToGroupMe", res.status);
}
