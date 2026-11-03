const ESC = '\u001b';
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;

/** A key as typed, or as part of pasted text. */
export interface DecodedKey {
  readonly key: string;
  readonly pasted: boolean;
}

/**
 * Turns what a terminal sends into keys: pasted text is marked (its line
 * breaks are text, not Enter) and escape sequences (arrows, Alt+key) are
 * dropped instead of becoming text like `[A`. Sequences may arrive split
 * across chunks.
 */
export class KeyDecoder {
  private escape: string | undefined;
  private pasting = false;

  /**
   * `onSequence` hears the sequences that are not text (arrows, PageUp…),
   * whole, for whoever gives them a meaning; they still never become keys.
   */
  public constructor(
    private readonly onSequence?: (sequence: string) => void,
  ) {}

  public feed(chunk: string): DecodedKey[] {
    const keys: DecodedKey[] = [];

    for (const key of chunk) {
      if (this.escape === undefined) {
        if (key === ESC) this.escape = key;
        else keys.push({ key, pasted: this.pasting });
        continue;
      }

      const sequence = this.escape + key;
      if (sequence === PASTE_START || sequence === PASTE_END) {
        this.pasting = sequence === PASTE_START;
        this.escape = undefined;
      } else if (
        PASTE_START.startsWith(sequence) ||
        PASTE_END.startsWith(sequence)
      ) {
        this.escape = sequence;
      } else if (sequence.length === 2 && key !== '[') {
        // Alt+key or a lone Esc: the key still counts.
        this.escape = undefined;
        keys.push({ key, pasted: this.pasting });
      } else {
        // A CSI sequence (arrows…) ends at its final byte.
        const ended = /[@-~]/.test(key) && sequence.length > 2;
        this.escape = ended ? undefined : sequence;
        if (ended) this.onSequence?.(sequence);
      }
    }

    return keys;
  }
}
