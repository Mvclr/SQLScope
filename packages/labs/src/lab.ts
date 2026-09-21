export type Level = 'iniciante' | 'intermediário' | 'avançado';

/**
 * The live panel a lab needs beside the editor. Each one shows the database answering a
 * question the lab is about: what the parser understood, who may do what, which rows a
 * role can see.
 */
export type LabPanel = 'ast' | 'privileges' | 'policies';

export interface LabStep {
  readonly id: string;
  readonly title: string;
  /** What this step is about, in prose. */
  readonly brief: string;
  /** SQL the step puts in the editor, ready to run. */
  readonly sql: string;
  /** What to look for after running it — the point of the step. */
  readonly expect: string;
  /**
   * SQLSTATE this step is supposed to end in. Several steps teach by being refused, and
   * naming the code keeps the promise testable: a lab whose SQL stopped behaving as the
   * text says would be worse than no lab.
   */
  readonly refused?: string;
  /**
   * Rows the last statement should return. The lesson of a step is usually a number of
   * rows — four, then zero, then two — so the number belongs where it can be checked.
   */
  readonly rows?: number;
}

/**
 * A guided exercise against a database the learner owns.
 *
 * Labs are data, like scenarios (ADR 0006's reasoning applies: content that is read, not
 * executed, does not need code). They run on T0, in the browser, where the learner is
 * superuser and can create roles and policies — which is the whole subject here.
 */
export interface Lab {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly level: Level;
  readonly panel: LabPanel;
  /** What the lab is trying to teach, shown before the first step. */
  readonly premise: string;
  /** DDL and data the lab starts from. */
  readonly setup: string;
  readonly steps: readonly LabStep[];
}
