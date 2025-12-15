// utils/aiThemeRandomizer.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const normalizeHex = (value) => {
  if (!value) return value;
  let v = String(value).trim();
  if (!v.startsWith("#")) v = `#${v}`;
  if (v.length > 7) v = v.slice(0, 7);
  return v.toUpperCase();
};

const isValidHex = (value) =>
  /^#[0-9A-F]{6}$/.test(String(value || "").toUpperCase());

const hexToRgb = (hex) => {
  const h = normalizeHex(hex);
  if (!isValidHex(h)) return null;
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
};

const rgbDistance = (a, b) => {
  // Euclidean distance in RGB space (0..441)
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  if (!ar || !br) return 0;
  const dr = ar.r - br.r;
  const dg = ar.g - br.g;
  const db = ar.b - br.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

const brightness = (hex) => {
  // perceived brightness 0..255-ish
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
};

const clampTheme = (theme) => ({
  bannerColor: normalizeHex(theme.bannerColor),
  backgroundColor: normalizeHex(theme.backgroundColor),
  boxColor: normalizeHex(theme.boxColor),
  contactButtonColor: normalizeHex(theme.contactButtonColor),
  textColor: normalizeHex(theme.textColor),
});

const THEME_KEYS = [
  "bannerColor",
  "backgroundColor",
  "boxColor",
  "contactButtonColor",
  "textColor",
];

const isThemeComplete = (t) =>
  t && THEME_KEYS.every((k) => typeof t[k] === "string" && isValidHex(t[k]));

// Make sure it feels like a “new scheme”, not a tiny nudge
const isTooSimilarToCurrent = (next, current) => {
  if (!current) return false;

  // If current is missing keys, only compare ones it has.
  const comparisons = THEME_KEYS.filter((k) => isValidHex(normalizeHex(current[k])));
  if (comparisons.length === 0) return false;

  // Average distance across comparable keys
  const distances = comparisons.map((k) =>
    rgbDistance(next[k], normalizeHex(current[k]))
  );
  const avg = distances.reduce((a, b) => a + b, 0) / distances.length;

  // ✅ Tweak this:
  // ~40 = noticeable, ~60 = clearly different, ~80 = very different
  return avg < 60;
};

const failsLocalRules = (t) => {
  // Must be valid hex everywhere
  if (!isThemeComplete(t)) return true;

  // Avoid near-white for banner/contact (white text goes on top)
  const nearWhite = (hex) => brightness(hex) > 235;
  if (nearWhite(t.bannerColor)) return true;
  if (nearWhite(t.contactButtonColor)) return true;

  // background vs box must be visually different
  if (rgbDistance(t.backgroundColor, t.boxColor) < 45) return true;

  // Text color should be reasonably readable against box (basic sanity)
  // (not full WCAG, just avoid “same color text”)
  if (rgbDistance(t.textColor, t.boxColor) < 60) return true;

  return false;
};

async function callModel({ vibe, currentTheme }) {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const tools = [
    {
      type: "function",
      function: {
        name: "pick_theme",
        description:
          "Pick a cohesive profile theme. Return ONLY valid 6-digit hex colors.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: THEME_KEYS,
          properties: {
            bannerColor: { type: "string", description: "Hex like #A1B2C3" },
            backgroundColor: { type: "string", description: "Hex like #A1B2C3" },
            boxColor: { type: "string", description: "Hex like #A1B2C3" },
            contactButtonColor: { type: "string", description: "Hex like #A1B2C3" },
            textColor: { type: "string", description: "Hex like #A1B2C3" },
          },
        },
      },
    },
  ];

  const prompt = `
Generate a cohesive color scheme for a MySpace/Tumblr-inspired profile editor.

Vibe: ${vibe}

Hard rules:
- Return ONLY 6-digit hex colors like #A1B2C3 (no words, no rgba).
- Must return ALL of: bannerColor, backgroundColor, boxColor, contactButtonColor, textColor.
- bannerColor and contactButtonColor must NOT be white or near-white.
- backgroundColor must clearly differ from boxColor (boxes must stand out).
- textColor must clearly differ from boxColor.
- IMPORTANT: This must be a NEW scheme, noticeably different from the current theme.

Current theme (do NOT reuse; only for “be different from this”):
${JSON.stringify(currentTheme || {}, null, 2)}
`.trim();

  const completion = await client.chat.completions.create({
    model,
    temperature: 1.0, // a bit more variety
    messages: [
      { role: "system", content: "You are a precise UI theme designer." },
      { role: "user", content: prompt },
    ],
    tools,
    tool_choice: { type: "function", function: { name: "pick_theme" } },
  });

  const msg = completion?.choices?.[0]?.message;
  const toolCall = msg?.tool_calls?.[0];

  if (!toolCall?.function?.arguments) {
    throw new Error("No tool output returned from OpenAI.");
  }

  let theme;
  try {
    theme = JSON.parse(toolCall.function.arguments);
  } catch (e) {
    throw new Error("Tool output was not valid JSON.");
  }

  return clampTheme(theme);
}

async function getRandomTheme({
  vibe = "MyTop6 nostalgic y2k / myspace / tumblr",
  currentTheme = {},
} = {}) {
  const current = {
    bannerColor: normalizeHex(currentTheme?.bannerColor),
    backgroundColor: normalizeHex(currentTheme?.backgroundColor),
    boxColor: normalizeHex(currentTheme?.boxColor),
    contactButtonColor: normalizeHex(currentTheme?.contactButtonColor),
    textColor: normalizeHex(currentTheme?.textColor),
  };

  const MAX_TRIES = 4;
  let last;

  for (let i = 0; i < MAX_TRIES; i++) {
    const t = await callModel({ vibe, currentTheme: current });
    last = t;

    if (failsLocalRules(t)) continue;
    if (isTooSimilarToCurrent(t, current)) continue;

    // ✅ return BOTH
    return { theme: t, vibeUsed: vibe };
  }

  // If we couldn't get a perfect one, return last valid attempt
  if (last && isThemeComplete(last)) {
    return { theme: last, vibeUsed: vibe };
  }

  throw new Error("Failed to generate a valid theme.");
}

module.exports = { getRandomTheme };
