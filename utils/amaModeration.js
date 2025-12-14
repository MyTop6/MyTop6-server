// utils/amaModeration.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = "omni-moderation-latest";

// Extra “hard block” phrases (helps catch obvious stuff fast)
const HARD_BLOCK_REGEXES = [
  /\bkill\s*yourself\b/i,
  /\bgo\s*die\b/i,
  /\bkys\b/i,
  /\bunalive\s*yourself\b/i,
];

function pickReasons(categories = {}) {
  return Object.entries(categories)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}

async function moderateAmaQuestion(text) {
  const t = (text || "").trim();
  if (!t) {
    return { action: "block", message: "Your question is empty." };
  }

  // quick hard-block pass
  if (HARD_BLOCK_REGEXES.some((re) => re.test(t))) {
    return {
      action: "block",
      message: "That message violates our guidelines. Please rephrase.",
      reasons: ["self_harm_or_harassment_phrase"],
    };
  }

  // OpenAI moderation
  const mod = await client.moderations.create({
    model: MODEL,
    input: t,
  });

  const result = mod?.results?.[0];
  const flagged = !!result?.flagged;
  const categories = result?.categories || {};
  const reasons = pickReasons(categories);

  // ✅ Block anything that looks like:
  // - self-harm encouragement / intent / instructions
  // - harassment/threatening
  // - hate
  // - violence
  const shouldBlock =
    flagged &&
    reasons.some((r) =>
      r.includes("self_harm") ||
      r.includes("harassment") ||
      r.includes("hate") ||
      r.includes("violence")
    );

  if (shouldBlock) {
    return {
      action: "block",
      message:
        "That question violates our community guidelines. Please rephrase it.",
      reasons,
    };
  }

  return { action: "allow" };
}

module.exports = { moderateAmaQuestion };
