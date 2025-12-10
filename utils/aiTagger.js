// utils/aiTagger.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const systemPrompt = `
You are tagging posts for a nostalgic social media site.
Your job is to decide short, descriptive tags that capture the post's vibe, topic, or context.

Rules:
- 3 to 8 tags.
- Tags should be SHORT (1–3 words).
- Use casual internet language where natural (e.g., "heartbreak", "late night thoughts", "pop punk", "vent", "family drama").
- No emojis.
- No hashtags (#).
- No user handles (@).
- No duplicates.
- English only.

Return a JSON object ONLY in this form:
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