// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/** Linear in/out animation of the outline width; reversible mid-flight. */
export class OutlineAnimator {
  private width = 0;
  private target = 0;
  constructor(
    private maxWidth: number,
    private ms: number,
  ) {}

  setTarget(on: boolean): void {
    this.target = on ? this.maxWidth : 0;
  }

  update(dtMs: number): number {
    if (this.ms <= 0) {
      this.width = this.target;
      return this.width;
    }
    const rate = this.maxWidth / this.ms; // px per ms
    const delta = Math.min(Math.abs(this.target - this.width), rate * dtMs);
    this.width += Math.sign(this.target - this.width) * delta;
    return this.width;
  }
}
