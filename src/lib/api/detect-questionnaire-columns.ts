import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ColDetectInput = {
  columns: Array<{ letter: string; header: string; samples: string[] }>;
  totalRows: number;
  availableLetters: string[]; // only suggest from these
};

export type ColDetectResult = {
  questionCol: string;
  answerCol: string;
  statusCol: string;
  headerRows: number;
  contextCols: string[]; // columns whose values clarify/categorise the question (e.g. Domain, Category)
  reasoning: string;
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const detectColumnsFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: ColDetectInput }) => {
    const token =
      getRequest().headers.get("authorization")?.replace("Bearer ", "") ?? "";
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) throw new Error("Unauthorized");

    const colDesc = data.columns
      .map((c) => {
        const samples = c.samples.length
          ? c.samples.map((s) => `"${s.slice(0, 100)}"`).join(" | ")
          : "(empty)";
        return `  Column ${c.letter}: header="${c.header}" | samples: ${samples}`;
      })
      .join("\n");

    const prompt = `You are analyzing a vendor assessment / RFP questionnaire spreadsheet.

COLUMNS (${data.totalRows} data rows detected):
${colDesc}

Your task: identify which column serves each role.

QUESTION column   — contains the vendor's questions, requirements, or criteria to be answered (usually long text, high fill rate)
RESPONSE column   — where the vendor (iMocha) should write answers (usually empty or nearly empty — this is the write target)
STATUS column     — compliance/coverage badge column (Comply / Partial / N/A or similar)
CONTEXT columns   — columns whose per-row values provide useful context about the question WITHOUT being the question itself.
                    Examples: Domain, Category, Sub-category, Section, Topic, Reference ID, Control ID.
                    These are typically short text (category labels or IDs) and help iMocha give a more targeted answer.
                    Return an empty array if no obvious context columns exist.
HEADER ROWS       — how many rows at the top to skip (title rows + column header rows combined)

Rules:
- QUESTION and RESPONSE must be different columns
- CONTEXT columns must not include the QUESTION, RESPONSE, or STATUS columns
- Only use letters from this list: ${data.availableLetters.join(", ")}

Return ONLY valid JSON, no markdown fences:
{
  "questionCol": "<letter>",
  "answerCol": "<letter>",
  "statusCol": "<letter>",
  "headerRows": <number>,
  "contextCols": ["<letter>", ...],
  "reasoning": "<one concise sentence explaining the key signals>"
}`;

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const raw =
      msg.content.find((b) => b.type === "text")?.text?.trim() ?? "";
    const cleaned = raw
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    const result = JSON.parse(cleaned) as ColDetectResult;

    // Validate returned letters are in the available set
    const valid = new Set(data.availableLetters);
    if (!valid.has(result.questionCol)) result.questionCol = data.availableLetters[0] ?? "A";
    if (!valid.has(result.answerCol)) result.answerCol = data.availableLetters[1] ?? "B";
    if (!valid.has(result.statusCol)) result.statusCol = data.availableLetters[2] ?? "C";

    // Validate and filter contextCols
    const mainCols = new Set([result.questionCol, result.answerCol, result.statusCol]);
    result.contextCols = (result.contextCols ?? []).filter(
      (l) => valid.has(l) && !mainCols.has(l),
    );

    return result;
  },
);
