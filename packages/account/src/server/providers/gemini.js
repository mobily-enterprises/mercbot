const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = "gemini-3.1-flash-image";
// Gemini's latest Flash model reads pictures well and cheaply.
const READING_MODEL = "gemini-flash-latest";

/**
 * A portrait (3:4) picture from a prompt and the pictures to start from, which it edits rather than drawing afresh:
 * `{ picture: { data, type } }`, or `{ refused, detail }` saying why there's none: "not-enabled" (the project's
 * billing allows no picture requests), "busy" (at its limit), "blocked" (Gemini wouldn't draw it, with its reason) or
 * "failed" (Gemini's own message). It's sent to `baseURL`, the layer's own address as the caller has it (a test copy's
 * stand-in model has its own, D-83); readPicture's likewise.
 * @param {{ baseURL: string, apiKey: string, prompt: string, sources: { type: string, data: Buffer }[], fetch: typeof fetch }} request
 * @returns {Promise<{ picture: { data: Buffer, type: string } } | { refused: "not-enabled" | "busy" | "blocked" | "failed", detail?: string }>}
 */
async function makePicture({ baseURL, apiKey, prompt, sources, fetch: send }) {
  const response = await send(`${baseURL}/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            ...sources.map((source) => ({ inlineData: { mimeType: source.type, data: source.data.toString("base64") } })),
            { text: prompt }
          ]
        }
      ],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } }
    }),
    signal: AbortSignal.timeout(150000)
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 429 && /limit: 0\b/u.test(body.error?.message || "")) return { refused: "not-enabled" };
  if (response.status === 429) return { refused: "busy" };
  if (!response.ok) return { refused: "failed", detail: body.error?.message || `The picture service answered ${response.status}.` };
  const part = body.candidates?.[0]?.content?.parts?.find((entry) => entry.inlineData?.data);
  if (!part) return { refused: "blocked", detail: body.promptFeedback?.blockReason || body.candidates?.[0]?.finishReason || "no picture came back" };
  return { picture: { data: Buffer.from(part.inlineData.data, "base64"), type: part.inlineData.mimeType || "image/png" } };
}

/**
 * What a picture shows, read as `instructions` say into a JSON object of the string `fields`: `{ text }`, the model's
 * answer, or `{ status, detail }` when Gemini refused, with its own message. A request that never reaches Gemini throws.
 * @param {{ baseURL: string, apiKey: string, instructions: string, prompt: string, picture: { type: string, data: Buffer }, fields: string[], fetch: typeof fetch }} request
 * @returns {Promise<{ text: string } | { status: number, detail: string }>}
 */
async function readPicture({ baseURL, apiKey, instructions, prompt, picture, fields, fetch: send }) {
  const response = await send(`${baseURL}/models/${READING_MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: picture.type, data: picture.data.toString("base64") } }, { text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT", properties: Object.fromEntries(fields.map((field) => [field, { type: "STRING" }])) }
      }
    }),
    signal: AbortSignal.timeout(60000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { status: response.status, detail: body.error?.message || "" };
  return { text: (body.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("") };
}

// Google Gemini: the one type images accept (D-72), drawing and editing pictures
// with Gemini's picture model, and reading what a photo shows with its Flash model. Its API reports no balance.
export const gemini = Object.freeze({
  id: "gemini",
  name: "Google Gemini",
  baseURL: BASE_URL,
  model: MODEL,
  // The picture model's list prices in dollars per million tokens (D-73): what goes in (the prompt and any pictures to
  // start from) and what comes out (a picture is about 1,290 tokens).
  prices: Object.freeze({ input: 0.3, output: 30 }),
  // The reading model's, for its calls that make no picture: Gemini 3.8 Flash, the newest Flash model on Google's
  // price list (2026-11-12, aistudio.google.com/docs/pricing), output including its thinking. They double on
  // 2027-01-01 (docs/next.md).
  readingPrices: Object.freeze({ input: 0.75, output: 3.75 }),
  makePicture,
  readPicture
});
