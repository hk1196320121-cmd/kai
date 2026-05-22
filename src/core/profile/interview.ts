import type { AddObservationInput } from "./engine";

export interface ColdStartAnswer {
  slug: string;
  text: string;
}

const WORD_COUNT_DETAIL_HIGH = 30;
const WORD_COUNT_DETAIL_MED = 10;
const WORD_COUNT_VERBOSE = 40;
const WORD_COUNT_MODERATE = 15;

export class InterviewEngine {
  extractSignalsFromAnswers(
    answers: ColdStartAnswer[],
    gitHints: { dimension: string; hints: string[] }[],
    workspaceId: string,
  ): AddObservationInput[] {
    const observations: AddObservationInput[] = [];
    const provenance = JSON.stringify({
      origin: "kai work start",
      extracted_at: new Date().toISOString(),
      extractor_version: "2.0.0",
    });

    const wordCounts: number[] = [];
    let anySpecifics = false;

    for (const { slug, text } of answers) {
      observations.push({
        type: "signal",
        key: `coldstart:${slug}`,
        value: JSON.stringify({ answer: text, workspace_id: workspaceId }),
        confidence: 8,
        source: "coldstart",
        provenance,
      });

      const wordCount = text.split(/\s+/).filter(Boolean).length;
      wordCounts.push(wordCount);
      if (/\d+|specific|exactly|precisely/.test(text)) anySpecifics = true;
    }

    if (wordCounts.length === 0) return observations;

    // Aggregate detail_level signal
    const avgWordCount =
      wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
    observations.push({
      type: "signal",
      key: "coldstart:signal.detail_level",
      value: JSON.stringify({
        level:
          avgWordCount > WORD_COUNT_DETAIL_HIGH || anySpecifics
            ? "high"
            : avgWordCount > WORD_COUNT_DETAIL_MED
              ? "medium"
              : "low",
        word_count: Math.round(avgWordCount),
        has_specifics: anySpecifics,
      }),
      confidence: 7,
      source: "coldstart",
      provenance,
    });

    // Aggregate comm_style signal
    observations.push({
      type: "signal",
      key: "coldstart:signal.comm_style",
      value: JSON.stringify({
        style:
          avgWordCount > WORD_COUNT_VERBOSE
            ? "verbose"
            : avgWordCount > WORD_COUNT_MODERATE
              ? "moderate"
              : "terse",
        word_count: Math.round(avgWordCount),
      }),
      confidence: 6,
      source: "coldstart",
      provenance,
    });

    // Domain detection from all answer text
    const allText = answers
      .map((a) => a.text)
      .join(" ")
      .toLowerCase();
    const domainSignals: string[] = [];
    if (/code|debug|deploy|api|git|build|test/i.test(allText))
      domainSignals.push("engineering");
    if (/design|ux|ui|wireframe|prototype/i.test(allText))
      domainSignals.push("design");
    if (/manage|team|sprint|roadmap|stakeholder/i.test(allText))
      domainSignals.push("management");
    if (/research|paper|study|analysis|data/i.test(allText))
      domainSignals.push("research");
    if (/write|document|content|blog|report/i.test(allText))
      domainSignals.push("writing");

    if (domainSignals.length > 0) {
      if (gitHints.some((h) => h.dimension === "detail_oriented")) {
        domainSignals.push("engineering");
      }
      observations.push({
        type: "signal",
        key: "coldstart:signal.domain",
        value: JSON.stringify({ domains: [...new Set(domainSignals)] }),
        confidence: 7,
        source: "coldstart",
        provenance,
      });
    }

    return observations;
  }
}
