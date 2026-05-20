import type { ProfileEngine } from "../profile/engine";
import type { OrchestratorStore } from "./store";

export interface ClusterResult {
  theme: string;
  count: number;
  sampleObservations: string[];
}

export const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "it",
  "that",
  "this",
  "was",
  "are",
  "be",
  "have",
  "has",
  "had",
  "not",
  "they",
  "i",
  "you",
  "he",
  "she",
  "we",
  "my",
  "your",
  "his",
  "her",
  "our",
  "its",
  "what",
  "which",
  "who",
  "when",
  "where",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "too",
  "very",
  "can",
  "will",
  "just",
  "should",
  "now",
  "also",
  "than",
  "then",
  "so",
  "if",
  "about",
  "up",
  "out",
  "do",
  "did",
  "get",
  "got",
  "want",
  "like",
  "would",
  "could",
  "think",
  "know",
  "see",
  "make",
  "go",
  "going",
  "really",
  "thing",
  "things",
  "much",
]);

export class IdeaClusterer {
  private profileEngine: ProfileEngine;
  private store: OrchestratorStore;

  constructor(profileEngine: ProfileEngine, store: OrchestratorStore) {
    this.profileEngine = profileEngine;
    this.store = store;
  }

  detectClusters(): ClusterResult[] {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ");
    const observations = this.profileEngine.getObservations({ since });
    const wordCounts = new Map<string, { count: number; samples: string[] }>();
    const existingIdeas = this.getAllIdeaThemes();

    for (const obs of observations) {
      const text = this.extractText(obs.value);
      const words = this.tokenize(text);
      for (const word of words) {
        const existing = wordCounts.get(word);
        if (existing) {
          existing.count++;
          if (existing.samples.length < 3)
            existing.samples.push(text.slice(0, 100));
        } else {
          wordCounts.set(word, { count: 1, samples: [text.slice(0, 100)] });
        }
      }
    }

    const clusters: ClusterResult[] = [];
    for (const [theme, data] of wordCounts) {
      if (data.count >= 3 && !existingIdeas.has(theme.toLowerCase())) {
        clusters.push({
          theme,
          count: data.count,
          sampleObservations: data.samples,
        });
      }
    }
    return clusters.sort((a, b) => b.count - a.count).slice(0, 5);
  }

  private extractText(value: string): string {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed.text === "string") return parsed.text;
      if (typeof parsed === "string") return parsed;
      return "";
    } catch {
      return value;
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  }

  private getAllIdeaThemes(): Set<string> {
    const ideas = [
      ...this.store.listIdeasByStatus("draft"),
      ...this.store.listIdeasByStatus("planned"),
      ...this.store.listIdeasByStatus("executing"),
    ];
    const themes = new Set<string>();
    for (const idea of ideas) {
      const words = this.tokenize(`${idea.title} ${idea.description}`);
      for (const word of words) themes.add(word);
    }
    return themes;
  }
}
