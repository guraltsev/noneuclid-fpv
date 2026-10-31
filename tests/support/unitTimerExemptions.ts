/**
 * Unit-tier files exempted from the real-timer guard installed by `unitSetup.ts`.
 *
 * Empty as of job 41: no unit file was found calling `setTimeout`/`setInterval` with a delay above zero (a
 * delay of exactly 0, and fake timers, are always allowed and need no exemption). Add a file here, with a
 * comment naming the baseline line it matches in `tests/hygiene-baseline.txt` (rule H2), only if a later
 * change needs a real timer in the unit tier and cannot avoid it in scope.
 */
export const unitTimerExemptions = new Set<string>([]);
