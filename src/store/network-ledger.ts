import type { NetworkLedger } from '../network/types';
import type { Store } from './index';

/** A network ledger that also follows the agent's session. */
export interface StoreNetworkLedger extends NetworkLedger {
  /** Decisions and `once` approvals belong to this session from now on. */
  setSession(id: string): void;
}

/**
 * The network gate's ledger on the store: decisions and approvals of one
 * workspace (`root`) and provider, in the agent's session. Session
 * approvals live here, in memory; workspace ones in the store.
 */
export function networkLedger(
  store: Store,
  { root, provider }: { readonly root: string; readonly provider: string },
): StoreNetworkLedger {
  const sessionApprovals = new Set<string>();
  let session: string | undefined;

  return {
    setSession(id) {
      session = id;
    },

    approval(destination) {
      if (sessionApprovals.has(destination)) return 'Aprovado nesta sessão.';

      const approval = store
        .activeApprovals(root, session, 'network')
        .find((item) => item.pattern === destination);
      if (approval === undefined) return undefined;
      if (approval.kind === 'once') {
        store.consumeApproval(approval.id);
        return 'Aprovado uma vez.';
      }
      return 'Aprovado para este workspace.';
    },

    remember(destination, scope) {
      if (scope === 'session') {
        sessionApprovals.add(destination);
        return;
      }
      // Given at the prompt: the connection already went through.
      store.saveApproval({
        root,
        pattern: destination,
        kind: 'workspace',
        category: 'network',
        notified: true,
      });
    },

    record({ destination, decision, decidedBy, reason, scope }) {
      return store.recordDecision({
        session,
        provider,
        root,
        command: destination,
        category: 'network',
        decision,
        source: decidedBy,
        ...(scope === undefined ? {} : { scope }),
        reason,
      });
    },
  };
}
