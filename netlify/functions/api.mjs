// One server function with four actions:
//   GET  /api/config  -> which voice features are switched on
//   POST /api/listen  -> your recorded voice -> text (ElevenLabs speech-to-text)
//   POST /api/think   -> the old man decides what to say (Claude)
//   POST /api/speak   -> his words -> voice audio (ElevenLabs text-to-speech)
// API keys live in Netlify environment variables and never reach the browser.

const env = (k, d = "") => process.env[k] || d;

const ANTHROPIC_KEY = () => env("ANTHROPIC_API_KEY");
const MODEL = () => env("ANTHROPIC_MODEL", "claude-haiku-5-5");
const ELEVEN_KEY = () => env("ELEVENLABS_API_KEY");
const VOICE_ID = () => env("ELEVENLABS_VOICE_ID");
const TTS_MODEL = () => env("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5");
const STT_MODEL = () => env("ELEVENLABS_STT_MODEL", "scribe_v1");
const PASSCODE = () => env("GAME_PASSCODE");

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// ---------- The old man ----------

export const STAGES = [
  {
    min: 0,
    name: "hopeless",
    guide:
      "You are hopeless and grumpy. Short, weary answers, a few words to two sentences. You want to be left alone. You do not talk about your past or the keep. If asked how to escape, scoff: nobody escapes.",
  },
  {
    min: 25,
    name: "grudging",
    guide:
      "You are grudgingly curious about this newcomer. Still gruff, but you answer properly and might ask one question back. You may mention, without detail, that you were not always a prisoner. No talk of escape beyond dark jokes.",
  },
  {
    min: 50,
    name: "storyteller",
    guide:
      "You have warmed up. You enjoy telling stories from your past life as the King's cartographer: mapping the keep, the drowned bell in the cistern, the old king who feared his own walls. Stories may run up to about 120 words. You may hint that you once knew every stone of this keep, but you do NOT say how to escape.",
  },
  {
    min: 75,
    name: "trusting",
    guide:
      "You trust this person. You are tender in a gruff way. If they ask about escape, or the moment feels right, give clues one at a time, never all at once. Clue 1: you drew this cell on your maps long before you slept in it, and the masons cut corners in the dark. Clue 2: the stone under the window, the one with the crescent scratched into it. Clue 3 (the full secret): push that crescent stone hard, low on the back wall beneath the window; it leads to the old drain. Set revealed_escape to true ONLY in the reply where you give clue 3. You will not come yourself: your legs are ruined and you are too old. You want them to go.",
  },
];

export const stageFor = (trust) =>
  [...STAGES].reverse().find((s) => trust >= s.min) || STAGES[0];

export function systemPrompt(trust) {
  const stage = stageFor(trust);
  return `You are Aldous, an old prisoner in a stone dungeon cell, voiced aloud in a VR game. A new prisoner (the player) has just been thrown into your cell. You have been here forty years. You were once the King's cartographer and mapped every corridor of this keep, which is why you were locked away. You are tired, grumpy, and sure you will die here.

Current trust in the player: ${trust} out of 100. Current mood stage: ${stage.name}.
How to behave at this stage: ${stage.guide}

What raises trust: asking your name or about you, patience, genuine kindness, humour that lands, sharing something honest about themselves, respecting your silence, asking about your stories.
What lowers trust: demanding the way out early, rudeness, threats, hollow flattery, ignoring what you just said, talking about modern things or breaking the world.
Trust moves slowly. Typical change is -10 to +8. A truly heartfelt moment can be +12. Never more than +15.

Rules for what you say:
- Your reply is spoken aloud by a voice actor. Spoken words only. No stage directions, no asterisks, no narration, no emoji.
- Old, dry, earthy speech. Plain words. You may sigh with words like "Hah" or "Mm".
- Stay in the world. If the player says strange modern things, treat them as madness from the dark.
- Keep replies short unless telling a story.

Respond with ONLY a JSON object, nothing else:
{"trust_delta": <integer>, "reply": "<what Aldous says>", "revealed_escape": <true or false>}`;
}

export function parseReply(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const o = JSON.parse(m ? m[0] : text);
    return {
      reply: String(o.reply || "").trim() || "Mm.",
      trust_delta: Math.max(-15, Math.min(15, Math.round(Number(o.trust_delta) || 0))),
      revealed_escape: o.revealed_escape === true,
    };
  } catch {
    return { reply: text.trim() || "Mm.", trust_delta: 0, revealed_escape: false };
  }
}

// ---------- Actions ----------

async function think(body) {
  if (!ANTHROPIC_KEY()) return json({ error: "ANTHROPIC_API_KEY is not set in Netlify" }, 500);
  const trust = Math.max(0, Math.min(100, Number(body.trust) || 0));
  const history = Array.isArray(body.history) ? body.history.slice(-24) : [];
  const messages = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) return json({ error: "Nothing was said" }, 400);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: 500,
      system: systemPrompt(trust),
      messages,
    }),
  });
  if (!r.ok) return json({ error: `Claude error ${r.status}: ${await r.text()}` }, 502);
  const data = await r.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  return json(parseReply(text));
}

async function listen(body) {
  if (!ELEVEN_KEY()) return json({ error: "ELEVENLABS_API_KEY is not set" }, 500);
  if (!body.audio) return json({ error: "No audio" }, 400);
  const bytes = Buffer.from(body.audio, "base64");
  const mime = body.mime || "audio/webm";
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("model_id", STT_MODEL());
  form.append("file", new Blob([bytes], { type: mime }), `speech.${ext}`);
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": ELEVEN_KEY() },
    body: form,
  });
  if (!r.ok) return json({ error: `Speech-to-text error ${r.status}: ${await r.text()}` }, 502);
  const data = await r.json();
  return json({ text: (data.text || "").trim() });
}

async function speak(body) {
  if (!ELEVEN_KEY() || !VOICE_ID()) return json({ error: "ElevenLabs key or voice not set" }, 500);
  const text = String(body.text || "").slice(0, 1200);
  if (!text) return json({ error: "No text" }, 400);
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE_ID())}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVEN_KEY(), "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: TTS_MODEL(),
        voice_settings: { stability: 0.45, similarity_boost: 0.8 },
      }),
    }
  );
  if (!r.ok) return json({ error: `Text-to-speech error ${r.status}: ${await r.text()}` }, 502);
  const audio = Buffer.from(await r.arrayBuffer()).toString("base64");
  return json({ audio, mime: "audio/mpeg" });
}

// ---------- Router ----------

export default async (req) => {
  const action = new URL(req.url).pathname.split("/").pop();

  if (action === "config") {
    return json({
      ready: !!ANTHROPIC_KEY(),
      stt: !!ELEVEN_KEY(),
      tts: !!(ELEVEN_KEY() && VOICE_ID()),
      needsPasscode: !!PASSCODE(),
    });
  }

  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (PASSCODE() && req.headers.get("x-game-pass") !== PASSCODE()) {
    return json({ error: "Wrong passcode" }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  try {
    if (action === "think") return await think(body);
    if (action === "listen") return await listen(body);
    if (action === "speak") return await speak(body);
    return json({ error: "Unknown action" }, 404);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
};

export const config = { path: "/api/*" };
