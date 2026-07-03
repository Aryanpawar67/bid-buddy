import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CRITERIA_META: Record<string, { parameter: string; weight: number }> = {
  strategic_fit:    { parameter: "Strategic Opportunity Fit",                weight: 0.15 },
  business_problem: { parameter: "Business Problem Clarity",                 weight: 0.10 },
  use_case:         { parameter: "Use Case Alignment",                       weight: 0.10 },
  stakeholder:      { parameter: "Customer Stakeholder & Decision Readiness", weight: 0.10 },
  commercial:       { parameter: "Commercial Attractiveness",                 weight: 0.10 },
  competitive:      { parameter: "Competitive Position",                      weight: 0.10 },
  implementation:   { parameter: "Implementation Feasibility",                weight: 0.10 },
  technical:        { parameter: "Technical & Security Fit",                  weight: 0.10 },
  proposal_risk:    { parameter: "Proposal Risk Assessment",                  weight: 0.10 },
  value_realization:{ parameter: "Value Realization & Expansion Potential",  weight: 0.05 },
};

export const generateQualificationInsightsFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { bidId: string } }) => {
    try {
    const authHeader = getRequest().headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) throw new Error("Unauthorized");

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) throw new Error(`Auth failed: ${authErr?.message}`);

    // Fetch bid + assessment data
    const { data: bid, error: bidErr } = await supabaseAdmin
      .from("bids")
      .select("client_name, title, type, value, priority, assessment_data")
      .eq("id", data.bidId)
      .maybeSingle();
    if (bidErr || !bid) throw new Error(`Bid not found: ${bidErr?.message}`);

    const assessmentData = (bid as any).assessment_data as {
      scores: Record<string, number>;
      comments: Record<string, string>;
    } ?? { scores: {}, comments: {} };

    // Build scored criteria summary for the prompt
    const criteriaLines = Object.entries(CRITERIA_META).map(([id, meta]) => {
      const score = assessmentData.scores[id] ?? 0;
      const comment = assessmentData.comments[id] ?? "";
      const weighted = ((score / 5) * meta.weight * 100).toFixed(1);
      return `- ${meta.parameter} (weight ${Math.round(meta.weight * 100)}%): score ${score}/5, weighted ${weighted}${comment ? `, note: "${comment}"` : ""}`;
    }).join("\n");

    const totalScore = Object.entries(CRITERIA_META).reduce((sum, [id, meta]) => {
      return sum + ((assessmentData.scores[id] ?? 0) / 5) * meta.weight * 100;
    }, 0);
    const roundedScore = Math.round(totalScore);
    const decision = roundedScore >= 65 ? "Go" : roundedScore >= 45 ? "Conditional Go" : "No Go";

    const prompt = `You are a bid qualification analyst at iMocha, a Skills Intelligence platform company.

Bid details:
- Client: ${bid.client_name}
- Opportunity: ${bid.title}
- Type: ${bid.type.toUpperCase()}
- Value: $${((bid as any).value ?? 0).toLocaleString()}
- Priority: ${bid.priority}

Assessment scores (each criterion scored 1–5 by the bid team):
${criteriaLines}

Overall weighted score: ${roundedScore}/100 → Recommendation: ${decision}

Based on this structured assessment, generate a qualification analysis in JSON format:
{
  "strengths": ["3–5 specific bullet points highlighting what makes this opportunity strong, referencing high-scoring criteria and their business implication"],
  "risks": ["3–5 specific bullet points on risks or gaps, referencing low-scoring criteria or missing information that needs attention"],
  "recommendation": "2–3 sentence executive summary recommending whether to pursue, with conditions if applicable"
}

Rules:
- Be specific to the scores and comments provided — do not hallucinate details not in the data
- Strengths should reference criteria scoring 4–5; risks should reference criteria scoring 1–3
- If a criterion has score 0 (not yet assessed), flag it as an information gap in risks
- Keep bullets concise (one sentence each)
- Return only the JSON object, no markdown fences`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.Messages.TextBlock).text)
      .join("");

    let insights: { strengths: string[]; risks: string[]; recommendation: string };
    try {
      const cleaned = rawText.replace(/^```[a-z]*\n?/m, "").replace(/```$/m, "").trim();
      insights = JSON.parse(cleaned);
    } catch {
      throw new Error("Failed to parse AI response");
    }

    // Persist insights back into assessment_data
    const updated = {
      ...assessmentData,
      insights: { ...insights, generated_at: new Date().toISOString() },
    };
    await supabaseAdmin
      .from("bids")
      .update({ assessment_data: updated } as never)
      .eq("id", data.bidId);

    return insights;
    } catch (e) {
      console.error("[qual-insights] error:", e);
      throw e;
    }
  });
