/**
 * Power analysis: the smallest gap an eval can reliably see (paper §5.3).
 *
 * Score noise per question splits into question luck (variance ω² of the
 * per-question mean scores) and answer luck (mean conditional variance σ²,
 * shrinkable by asking each question K times, or eliminated by grading with
 * the model's own answer probabilities). Temperature 0 is NOT a legitimate
 * shrink — it measures a different model (§3.2).
 */

/** Two-sided critical values for the supported false-alarm rates. */
export const Z_ALPHA: Record<string, number> = {
  "0.01": 2.575829,
  "0.05": 1.959964,
  "0.1": 1.644854,
};

/** One-sided z for the supported power levels. */
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
  /** answer-luck variance σ² per model (default equal for both) */
  sigma2A: number;
  sigma2B: number;
  /** resamples per question */
  K: number;
}

function zs(alpha: number, power: number): [number, number] {
  const za = Z_ALPHA[String(alpha)];
  const zb = Z_POWER[String(power)];
  if (za === undefined) throw new Error(`unsupported alpha: ${alpha}`);
  if (zb === undefined) throw new Error(`unsupported power: ${power}`);
  return [za, zb];
}

/**
 * Questions needed for a paired comparison to reliably detect `delta`
 * (paper Eq. 9): n = (z_{α/2} + z_β)² · (ω² + σ²_A/K + σ²_B/K) / δ².
 * Here ω² is the variance of the per-question score *differences*' means —
 * pass the paired-difference decomposition when you have one.
 */
export function questionsNeeded(p: PowerParams): number {
  const [za, zb] = zs(p.alpha, p.power);
  const variance = p.omega2 + p.sigma2A / p.K + p.sigma2B / p.K;
  return Math.ceil(((za + zb) ** 2 * variance) / (p.delta * p.delta));
}

/** Inverse: smallest reliably-detectable gap for a given question count. */
export function minimumDetectableEffect(
  p: Omit<PowerParams, "delta"> & { n: number },
): number {
  const [za, zb] = zs(p.alpha, p.power);
  const variance = p.omega2 + p.sigma2A / p.K + p.sigma2B / p.K;
  return (za + zb) * Math.sqrt(variance / p.n);
}

/**
 * Total per-question variance ω² + σ²/K (paper §3.2) — the quantity a K-fold
 * resampling divides, used to show the answer-luck floor.
 */
export function perQuestionVariance(
  omega2: number,
  sigma2: number,
  K: number,
): number {
  return omega2 + sigma2 / K;
}
