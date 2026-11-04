/**
 * The unions types.ts copies (so the pages compile without Node) must stay
 * equal to their originals: a drift fails the typecheck here.
 */

import type { NetworkDecisionSource } from '../network/types';
import type { HostState } from '../workspace/sandbox/host-access';
import type { WorkspaceType } from '../workspace/index';
import type {
  RoundDecisionSource,
  RoundHostState,
  RoundWorkspaceType,
} from './types';

/** `true` only when each of `A` and `B` fits in the other: the same union. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Compiles only with `true`. */
type Expect<T extends true> = T;

export type Compat = [
  Expect<Same<RoundWorkspaceType, WorkspaceType>>,
  Expect<Same<RoundHostState, HostState>>,
  Expect<Same<RoundDecisionSource, NetworkDecisionSource>>,
];
