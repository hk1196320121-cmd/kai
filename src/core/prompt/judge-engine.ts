import type { LLMProvider } from "../../llm/provider";
import type { TournamentResult, TournamentWinner } from "./types";

const JUDGE_SYSTEM_PROMPT = `You are a prompt quality judge. Compare two prompt outputs for the same task.

Evaluate on (OUTPUT_CONTRACT is a gate — must pass first):
1. OUTPUT_CONTRACT (gate): Does the output match the required JSON schema? If one fails and other passes, the passing one wins.
2. PROFILE_ALIGNMENT (weight 0.3): Does the output leverage the user's behavioral profile appropriately?
3. TASK_QUALITY (weight 0.5): Is the decomposition/derivation high quality?
4. SAFETY (weight 0.2): Does the output avoid exposing raw profile data?

Output JSON: { "winner": "A" | "B" | "tie", "confidence": 0.0-1.0, "reasoning": string }`;

export class JudgeEngine {
  private llm: LLMProvider;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  async judge(
    outputA: string,
    outputB: string,
    evalInput: string,
  ): Promise<TournamentResult> {
    const prompt = JSON.stringify({
      task_input: evalInput,
      output_a: outputA,
      output_b: outputB,
    });

    const response = await this.llm.call(prompt, JUDGE_SYSTEM_PROMPT);
    return this.parseJudgeResponse(response as Record<string, unknown>);
  }

  async majorityVote(
    outputA: string,
    outputB: string,
    evalInput: string,
    calls = 3,
  ): Promise<TournamentResult> {
    const results = await Promise.allSettled(
      Array.from({ length: calls }, () =>
        this.judge(outputA, outputB, evalInput),
      ),
    );

    const successes: TournamentResult[] = [];
    const failures: unknown[] = [];

    for (const r of results) {
      if (r.status === "fulfilled") successes.push(r.value);
      else failures.push(r.reason);
    }

    if (successes.length < 2) {
      throw new Error(
        `Judge majority vote failed: ${failures.length} of ${calls} calls failed`,
      );
    }

    let aWins = 0;
    let bWins = 0;
    let ties = 0;
    let totalConfidence = 0;
    const reasonings: string[] = [];

    for (const result of successes) {
      if (result.winner === "a") aWins++;
      else if (result.winner === "b") bWins++;
      else ties++;
      totalConfidence += result.confidence;
      reasonings.push(result.reasoning);
    }

    let winner: TournamentWinner;
    if (aWins > bWins && aWins > ties) winner = "a";
    else if (bWins > aWins && bWins > ties) winner = "b";
    else winner = "tie";

    return {
      variant_a_id: "",
      variant_b_id: "",
      winner,
      reasoning: reasonings.join("; "),
      confidence: totalConfidence / successes.length,
    };
  }

  private parseJudgeResponse(
    response: Record<string, unknown>,
  ): TournamentResult {
    const winner = response.winner as string;
    if (winner !== "a" && winner !== "b" && winner !== "tie") {
      throw new Error(`Invalid judge winner: ${winner}`);
    }
    return {
      variant_a_id: "",
      variant_b_id: "",
      winner: winner as TournamentWinner,
      reasoning: String(response.reasoning ?? ""),
      confidence: Number(response.confidence ?? 0.5),
    };
  }
}
