// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/** The element with this id (the pages' ids are fixed, so it is assumed to exist). */
export const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Whether the visitor asked for reduced motion (live: follows the setting as it changes). */
export const reducedMotion = (): boolean => reduceQuery.matches;
