/**
 * Events inside Goiaba, between producers and consumers that do not know each
 * other: they meet by the producer's name.
 *
 * - A producer (`createProducer('course')`) emits what happened under its
 *   name.
 * - A consumer (`createConsumer(listener)`) subscribes to the producers it
 *   cares about, one or several, and gets only theirs; it unsubscribes from
 *   one or from all.
 *
 * Nothing here leaves the process: delivering is the output's job, recording
 * is the logger's.
 */

import { currentScope, type ScopeFields } from '../scope/index';

/** One event, as consumers get it. */
export interface GoiabaEvent extends ScopeFields {
  /** The producer's name: `agent`, `network`, `course`… */
  readonly source: string;
  /** What happened within the producer: `input`, `output`, `thinking`… */
  readonly type: string;
  /** ISO date and time it was emitted. */
  readonly ts: string;
  readonly [key: string]: unknown;
}

/** What a producer emits; `source`, `ts` and the scope are added. */
export interface EventInput {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface Producer {
  /** Its name: what consumers subscribe to. */
  readonly source: string;
  emit(input: EventInput): void;
}

export type EventListener = (event: GoiabaEvent) => void;

export interface Consumer {
  /** Starts getting the events of these producers. */
  subscribe(...sources: readonly string[]): void;
  /** Stops getting the events of these producers. */
  unsubscribe(...sources: readonly string[]): void;
  /** Stops getting events from every producer. */
  unsubscribeAll(): void;
  /** The producers it is subscribed to now. */
  sources(): readonly string[];
}

/** Every producer, for consumers such as a debugging panel. */
export const ALL_SOURCES = '*';

const consumers = new Map<string, Set<EventListener>>();

/** A producer named `source`: what it emits reaches its subscribers. */
export function createProducer(source: string): Producer {
  if (source.length === 0 || source === ALL_SOURCES) {
    throw new Error(`Nome de produtor inválido: "${source}".`);
  }

  return {
    source,
    emit(input) {
      const event: GoiabaEvent = {
        ts: new Date().toISOString(),
        ...currentScope(),
        ...input,
        // Last: an input cannot pass for another producer.
        source,
      };
      // Once each, also when subscribed to the name and to all; a copy, so
      // a listener may subscribe or unsubscribe meanwhile.
      const listeners = new Set([
        ...(consumers.get(source) ?? []),
        ...(consumers.get(ALL_SOURCES) ?? []),
      ]);
      for (const listener of listeners) listener(event);
    },
  };
}

/** A consumer: `listener` gets the events of the producers it subscribes to. */
export function createConsumer(listener: EventListener): Consumer {
  const subscribed = new Set<string>();
  // Its own entry: two consumers of the same function stay apart.
  const receive: EventListener = (event) => listener(event);

  const unsubscribe = (...sources: readonly string[]): void => {
    for (const source of sources) {
      subscribed.delete(source);
      const listeners = consumers.get(source);
      listeners?.delete(receive);
      if (listeners?.size === 0) consumers.delete(source);
    }
  };

  return {
    subscribe(...sources) {
      for (const source of sources) {
        subscribed.add(source);
        const listeners = consumers.get(source) ?? new Set<EventListener>();
        listeners.add(receive);
        consumers.set(source, listeners);
      }
    },
    unsubscribe,
    unsubscribeAll: () => unsubscribe(...subscribed),
    sources: () => [...subscribed],
  };
}
