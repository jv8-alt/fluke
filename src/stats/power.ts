/**
 * Power analysis: the smallest gap an eval can reliably see (paper §5.3).
 *
 * Every benchmark has a resolution limit set mostly by its question count.
 * Below that limit, wins and losses are unreadable — the eval literally
 * cannot distinguish a real gap from question luck. These functions answer
 * the two directions of that question: "how many questions do I need to see
 * a δ-point gap?" and "what is the smallest gap THIS eval can see?".
 *
 * The variance being fought has two parts (paper §3.2):
 * - ω² — QUESTION luck: which questions landed in the eval. Only more
 *   questions shrink it.
 * - σ² — ANSWER luck: the model answers the same question differently run
 *   to run. Shrinks by asking each question K times (σ²/K), or vanishes
 *   entirely by grading with the model's own token probabilities (σ² = 0).
 *   Setting temperature to 0 is NOT a legitimate shrink — that changes the
 *   model being measured, and can raise the irreducible noise.
 */

/**
 * Two-sided critical values z_{α/2} for the supported false-alarm rates.
 * A lookup table (not an inverse-normal routine) on purpose: the UI offers
 * exactly these choices, and a table keeps the values auditable at a glance.
 */
export const Z_ALPHA: Record<string, number> = {
  "0.01": 2.575829,
  "0.05": 1.959964,
  "0.1": 1.644854,
};

/** One-sided z_β for the supported power levels (β = 1 − power). */
export const Z_POWER: Record<string, number> = {
  "0.8": 0.841621,
  "0.9": 1.281552,
};

export interface PowerParams {
  /** smallest true gap worth detecting, in score units (e.g. 0.03 = 3 pts) */
  delta: number;
  /** two-sided false-alarm rate: 0.01 | 0.05 | 0.1 */
  alpha: number;
  /** chance of catching a real gap of size delta: 0.8 | 0.9 */
  power: number;
  /** question-luck variance ω² (variance of per-question mean scores) */
  omega2: number;
  /** answer-luck variance σ² per model (they may differ) */
  sigma2A: number;
  sigma2B: number;
  /** resamples per question */
  K: number;
}

/**
 * Resolve the two z-scores, throwing on unsupported α/power rather than
 * silently interpolating — a wrong critical value would corrupt every
 * downstream "questions needed" claim.
 */
function zs(alpha: number, power: number): [number, number] {
  const za = Z_ALPHA[String(alpha)];
  const zb = Z_POWER[String(power)];
  if (za === undefined) throw new Error(`unsupported alpha: ${alpha}`);
  if (zb === undefined) throw new Error(`unsupported power: ${power}`);
  return [za, zb];
}

/**
 * Questions needed for a paired comparison to reliably detect a gap of
 * `delta` (paper Eq. 9):
 *
 *   n = (z_{α/2} + z_β)² · (ω² + σ²_A/K + σ²_B/K) / δ²
 *
 * Reading it: (z_{α/2} + z_β)² converts "confidence demanded" into a
 * multiplier; the middle factor is the per-question variance of the score
 * DIFFERENCES (ω² here is the question-luck variance of those differences —
 * pass the paired decomposition when you have one); dividing by δ² says that
 * resolving a gap half the size costs 4× the questions. Ceil because you
 * can't ask a fraction of a question.
 */
export function questionsNeeded(p: PowerParams): number {
  const [za, zb] = zs(p.alpha, p.power);
  const variance = p.omega2 + p.sigma2A / p.K + p.sigma2B / p.K;
  return Math.ceil(((za + zb) ** 2 * variance) / (p.delta * p.delta));
}

/**
 * Inverse of `questionsNeeded`: the smallest gap an eval of n questions can
 * reliably detect at the given α/power. This is the "check the eval's
 * eyesight before trusting it" number — a reported 2-point win on an eval
 * whose MDE is 3 points is noise wearing a medal.
 */
export function minimumDetectableEffect(
  p: Omit<PowerParams, "delta"> & { n: number },
): number {
  const [za, zb] = zs(p.alpha, p.power);
  const variance = p.omega2 + p.sigma2A / p.K + p.sigma2B / p.K;
  return (za + zb) * Math.sqrt(variance / p.n);
}

/**
 * Total per-question variance ω² + σ²/K (paper §3.2) — the quantity K-fold
 * resampling divides. Exposed separately so the UI can show the answer-luck
 * floor: as K grows the σ²/K term dies away but ω² remains, and past a few
 * repeats the curve visibly flattens — the "more repeats can't fix question
 * luck" lesson in one line.
 */
export function perQuestionVariance(
  omega2: number,
  sigma2: number,
  K: number,
): number {
  return omega2 + sigma2 / K;
}
