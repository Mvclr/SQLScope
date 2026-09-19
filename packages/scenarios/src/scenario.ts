export type Level = 'iniciante' | 'intermediário' | 'avançado';

export interface Challenge {
  readonly id: string;
  readonly title: string;
  /** What the learner is asked to produce. */
  readonly prompt: string;
  readonly hint?: string;
  /** Reference answer. Its output, variant by variant, is the definition of "correct". */
  readonly solution: string;
  /** Whether row order is part of the answer (the prompt must say so). */
  readonly ordered: boolean;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly level: Level;
  /** DDL creating the scenario's tables. */
  readonly schema: string;
  /**
   * Data for one variant. Variant 0 is what the learner explores; the others exist so
   * that an answer only passes if it computes the result instead of reproducing it.
   */
  seed(variant: number): string;
  /** Query pre-filled in the editor when the scenario opens. */
  readonly starter: string;
  readonly challenges: readonly Challenge[];
}

/** Variants every answer is checked against. */
export const VARIANTS = [0, 1, 2] as const;
