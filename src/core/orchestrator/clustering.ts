import type { ProfileEngine } from "../profile/engine";
import type { OrchestratorStore } from "./store";

/** Look back window for observations when clustering (7 days in ms) */
const CLUSTER_WINDOW_DAYS = 7 * 24 * 60 * 60 * 1000;
/** Minimum occurrence count for a word to be considered a cluster */
const MIN_CLUSTER_COUNT = 3;
/** Maximum number of clusters returned from detectClusters */
const MAX_CLUSTERS = 5;
/** Maximum sample texts stored per word */
const MAX_SAMPLES_PER_WORD = 3;
/** Character length of each sample text */
const SAMPLE_TEXT_LENGTH = 100;
/** Maximum observations to scan for clustering */
const MAX_OBSERVATIONS_FOR_CLUSTERING = 500;

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
    const since = new Date(Date.now() - CLUSTER_WINDOW_DAYS)
      .toISOString()
      .replace("T", " ");
    const observations = this.profileEngine.getObservations({
      since,
      limit: MAX_OBSERVATIONS_FOR_CLUSTERING,
    });
    const wordCounts = new Map<string, { count: number; samples: string[] }>();
    const existingIdeas = this.getAllIdeaThemes();

    for (const obs of observations) {
      const text = this.extractText(obs.value);
      const words = this.tokenize(text);
      for (const word of words) {
        const existing = wordCounts.get(word);
        if (existing) {
          existing.count++;
          if (existing.samples.length < MAX_SAMPLES_PER_WORD)
            existing.samples.push(text.slice(0, SAMPLE_TEXT_LENGTH));
        } else {
          wordCounts.set(word, {
            count: 1,
            samples: [text.slice(0, SAMPLE_TEXT_LENGTH)],
          });
        }
      }
    }

    const clusters: ClusterResult[] = [];
    for (const [theme, data] of wordCounts) {
      if (
        data.count >= MIN_CLUSTER_COUNT &&
        !existingIdeas.has(theme.toLowerCase())
      ) {
        clusters.push({
          theme,
          count: data.count,
          sampleObservations: data.samples,
        });
      }
    }
    return clusters.sort((a, b) => b.count - a.count).slice(0, MAX_CLUSTERS);
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
    const ideas = this.store.listIdeasByStatuses([
      "draft",
      "planned",
      "executing",
    ]);
    const themes = new Set<string>();
    for (const idea of ideas) {
      const words = this.tokenize(`${idea.title} ${idea.description}`);
      for (const word of words) themes.add(word);
    }
    return themes;
  }
}
