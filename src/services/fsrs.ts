// ============================================================
// FSRS Service — Spaced Repetition Scheduling
// Based on the Free Spaced Repetition Scheduler algorithm
// ============================================================

import { FSRSCard, FSRSState, FSRSRating } from "@/types";

const DEFAULT_PARAMS = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  // FSRS-5 default weights (17 parameters)
  w: [
    0.4, 0.6, 2.4, 5.8,   // initial stability for Again/Hard/Good/Easy
    4.93, 0.94, 0.86,      // difficulty parameters
    0.01, 1.49, 0.14,      // stability after failure
    0.94, 2.18, 0.05,      // stability after success
    0.34, 1.26, 0.29, 2.61 // additional parameters
  ],
};

export class FSRSService {
  private params: typeof DEFAULT_PARAMS;

  constructor(params?: Partial<typeof DEFAULT_PARAMS>) {
    this.params = { ...DEFAULT_PARAMS, ...params };
  }

  /**
   * Create a new review card for a claim
   */
  createCard(): FSRSCard {
    return {
      due: new Date(),
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: FSRSState.New,
      lastReview: null,
    };
  }

  /**
   * Calculate the current probability of recalling a card (0-1)
   * Uses the FSRS power forgetting curve: R = (1 + t/(9*S))^(-1)
   */
  getRetrievability(card: FSRSCard): number {
    if (card.state === FSRSState.New || !card.lastReview) return 0;

    const now = new Date();
    const lastReview = new Date(card.lastReview);
    const elapsedDays = (now.getTime() - lastReview.getTime()) / (1000 * 60 * 60 * 24);

    if (card.stability <= 0) return 0;

    return Math.pow(1 + elapsedDays / (9 * card.stability), -1);
  }

  /**
   * Schedule a card after a review, returns new card state
   */
  schedule(card: FSRSCard, rating: FSRSRating): FSRSCard {
    const now = new Date();
    const newCard = { ...card };

    if (card.state === FSRSState.New) {
      // First review — initialize stability and difficulty
      newCard.difficulty = this.initDifficulty(rating);
      newCard.stability = this.initStability(rating);
      newCard.reps = 1;
      newCard.state = rating === FSRSRating.Again
        ? FSRSState.Learning
        : FSRSState.Review;
    } else {
      // Subsequent reviews
      const retrievability = this.getRetrievability(card);

      if (rating === FSRSRating.Again) {
        // Failed recall
        newCard.lapses += 1;
        newCard.difficulty = this.nextDifficulty(card.difficulty, rating);
        newCard.stability = this.nextForgetStability(
          card.difficulty, card.stability, retrievability
        );
        newCard.state = FSRSState.Relearning;
      } else {
        // Successful recall
        newCard.difficulty = this.nextDifficulty(card.difficulty, rating);
        newCard.stability = this.nextRecallStability(
          card.difficulty, card.stability, retrievability, rating
        );
        newCard.state = FSRSState.Review;
      }
      newCard.reps += 1;
    }

    // Calculate next interval
    const interval = this.nextInterval(newCard.stability, rating);
    newCard.scheduledDays = interval;
    newCard.elapsedDays = card.lastReview
      ? (now.getTime() - new Date(card.lastReview).getTime()) / (1000 * 60 * 60 * 24)
      : 0;
    newCard.due = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
    newCard.lastReview = now;

    return newCard;
  }

  /**
   * Get all scheduling options for a card (what happens for each rating)
   */
  getSchedulingOptions(card: FSRSCard): Record<string, { card: FSRSCard; interval: number }> {
    return {
      again: { card: this.schedule(card, FSRSRating.Again), interval: this.nextInterval(this.schedule(card, FSRSRating.Again).stability, FSRSRating.Again) },
      hard: { card: this.schedule(card, FSRSRating.Hard), interval: this.nextInterval(this.schedule(card, FSRSRating.Hard).stability, FSRSRating.Hard) },
      good: { card: this.schedule(card, FSRSRating.Good), interval: this.nextInterval(this.schedule(card, FSRSRating.Good).stability, FSRSRating.Good) },
      easy: { card: this.schedule(card, FSRSRating.Easy), interval: this.nextInterval(this.schedule(card, FSRSRating.Easy).stability, FSRSRating.Easy) },
    };
  }

  /**
   * Calculate aggregate retention for a set of cards
   */
  getAggregateRetention(cards: FSRSCard[]): number {
    if (cards.length === 0) return 0;
    const total = cards.reduce((sum, card) => sum + this.getRetrievability(card), 0);
    return total / cards.length;
  }

  // --- Internal FSRS calculations ---

  private initDifficulty(rating: FSRSRating): number {
    // D0(G) = w4 - e^(w5*(G-1)) + 1
    const w = this.params.w;
    return Math.max(1, Math.min(10,
      w[4] - Math.exp(w[5] * (rating - 1)) + 1
    ));
  }

  private initStability(rating: FSRSRating): number {
    // S0(G) = w[G-1]
    return this.params.w[rating - 1];
  }

  private nextDifficulty(d: number, rating: FSRSRating): number {
    // D'(D,G) = w7 * D0(3) + (1-w7) * (D - w6*(G-3))
    const w = this.params.w;
    const d0 = w[4] - Math.exp(w[5] * (3 - 1)) + 1; // D0(Good)
    const newD = w[7] * d0 + (1 - w[7]) * (d - w[6] * (rating - 3));
    return Math.max(1, Math.min(10, newD));
  }

  private nextRecallStability(
    d: number, s: number, r: number, rating: FSRSRating
  ): number {
    // S'_r(D,S,R,G) = S * (e^(w8) * (11-D) * S^(-w9) * (e^(w10*(1-R))-1) * hardPenalty * easyBonus + 1)
    const w = this.params.w;
    const hardPenalty = rating === FSRSRating.Hard ? w[15] : 1;
    const easyBonus = rating === FSRSRating.Easy ? w[16] : 1;

    const newS = s * (
      Math.exp(w[8]) *
      (11 - d) *
      Math.pow(s, -w[9]) *
      (Math.exp(w[10] * (1 - r)) - 1) *
      hardPenalty *
      easyBonus +
      1
    );

    return Math.max(0.4, newS);
  }

  private nextForgetStability(d: number, s: number, r: number): number {
    // S'_f(D,S,R) = w11 * D^(-w12) * ((S+1)^w13 - 1) * e^(w14*(1-R))
    const w = this.params.w;
    const newS = w[11] *
      Math.pow(d, -w[12]) *
      (Math.pow(s + 1, w[13]) - 1) *
      Math.exp(w[14] * (1 - r));

    return Math.max(0.4, Math.min(newS, s)); // stability can't increase on failure
  }

  private nextInterval(stability: number, rating: FSRSRating): number {
    if (rating === FSRSRating.Again) {
      return 1; // 1 day for failed cards
    }

    // I(S,R) = 9*S*(1/R - 1)  where R = desired retention
    const interval = 9 * stability * (1 / this.params.requestRetention - 1);
    const clamped = Math.max(1, Math.min(Math.round(interval), this.params.maximumInterval));

    // Add small fuzz (±5%) to prevent clustering
    const fuzz = 1 + (Math.random() - 0.5) * 0.1;
    return Math.max(1, Math.round(clamped * fuzz));
  }
}

export const fsrs = new FSRSService();
export default fsrs;
