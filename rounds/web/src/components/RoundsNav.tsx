/** Every round, on top of every page: the current one is not a link. */

import type { ReactNode } from 'react';

import { rounds } from '../data';
import { href } from '../route';

export function RoundsNav({
  current,
}: {
  readonly current?: string;
}): ReactNode {
  return (
    <nav className="rounds" aria-label="Rodadas">
      <ol>
        <li>
          {current === undefined ? (
            <span aria-current="page">
              <small>Todas</small>Índice
            </span>
          ) : (
            <a href={href()}>
              <small>Todas</small>Índice
            </a>
          )}
        </li>
        {rounds.map(({ record, label }) => {
          const content = (
            <>
              <small>Rodada {label}</small>
              {record.review?.title ?? record.definition.id}
            </>
          );
          return (
            <li key={record.id}>
              {record.id === current ? (
                <span aria-current="page">{content}</span>
              ) : (
                <a href={href(record.id)}>{content}</a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
