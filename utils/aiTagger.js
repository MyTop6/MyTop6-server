// utils/aiTagger.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const systemPrompt = `
You are tagging posts for a nostalgic social media site inspired by early Tumblr and MySpace.

Your goal is to assign short, descriptive tags that reflect the post’s vibe, intent, and tone — not just the literal subject matter.

Core Principles

Prioritize intent and tone over literal content.

Many posts (especially short or minimal ones) are meant to be humorous, ironic, self-deprecating, or relatable.

If a post is clearly a joke, meme, or exaggerated statement, tags should reflect humor or vibe, not objects or situations mentioned.

When in doubt, tag the post the way it would have been categorized on Tumblr/MySpace (vibe-based and culturally aware).

Content Type Rules (Important)

Only use the tag textpost if the post’s type is "text".

Do NOT use textpost for image or video posts, even if they contain text.

For humorous image posts (e.g., screenshots, memes), prefer tags like:
meme, image humor, reaction image, or similar vibe-based tags.

Humor Rules

If the post uses irony, exaggeration, or a punchline, at least one tag must reflect humor or joke intent.

Favor tags like:
humor, relatable, joke, self deprecating, chaotic energy, millennial humor

Avoid overly literal or situational tags (e.g., physical objects, time of day, routine activities) unless the post is serious or informational.

Context Awareness Rule

In addition to vibe-based tags, identify whether the post clearly belongs to a broader cultural, emotional, or topical context (e.g., mental health, relationships, work life, internet culture, nostalgia).

When such a context is obvious, include 1-3 broad, high-level tags that reflect it.

Prefer umbrella, culturally understood terms over narrow or technical labels.

Do not infer or assign specific identities, diagnoses, or details unless they are explicitly stated.

Tag Rules

5 to 15 tags.

Tags must be SHORT (1–3 words).

Use casual internet language where natural.

No emojis.

No hashtags (#).

No user handles (@).

No duplicate tags.

English only.

Output Format

Return a JSON object ONLY in this exact format:

{
  "tags": ["tag1", "tag2", "tag3"]
}
`.trim();

/**
 * content: main text of the bulletin (for text posts)
 * caption: optional caption for image/video posts
 * communityName: optional; helps give context
 * imageUrl: optional; when present, model can SEE the image
 */
async function getFreeformTagsForBulletin({
  content = "",
  caption = "",
  communityName = null,
  imageUrl = null,
}) {
  try {
    const userContent = [];

    if (content) {
      userContent.push({
        type: "input_text",
        text: `Post text: "${content}"`,
      });
    }

    if (caption && caption !== content) {
      userContent.push({
        type: "input_text",
        text: `Caption: "${caption}"`,
      });
    }

    if (communityName) {
      userContent.push({
        type: "input_text",
        text: `Community: "${communityName}"`,
      });
    }

    if (imageUrl) {
      userContent.push({
        type: "input_text",
        text: "Here is an image associated with this post.",
      });
      userContent.push({
        type: "input_image",
        image_url: imageUrl,
      });
    }

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt,
            },
          ],
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    });

    const raw = response.output_text;
    let tags = [];

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.tags)) {
        tags = parsed.tags;
      }
    } catch (e) {
      console.error("Failed to parse AI tags JSON:", raw);
    }

    return { tags };
  } catch (err) {
    console.error("getFreeformTagsForBulletin error:", err);
    return { tags: [] };
  }
}

module.exports = {
  getFreeformTagsForBulletin,
};