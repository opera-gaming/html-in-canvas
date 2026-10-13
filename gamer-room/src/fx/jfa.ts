// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/** Jump-flood step schedule: N/2, N/4, …, 1 where N is the next power of two >= max(width, height). */
export function jfaSteps(width: number, height: number): number[] {
  const maxDim = Math.max(1, width, height);
  let n = 1;
  while (n < maxDim) n *= 2;
  const steps: number[] = [];
  for (let s = n / 2; s >= 1; s /= 2) steps.push(s);
  return steps.length ? steps : [1];
}
