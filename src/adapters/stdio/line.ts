const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The line being typed, as text: what is typed or pasted joins it, a
 * backspace removes its last character (as seen: an accent and its letter,
 * an emoji), and taking it starts a new one. Knows nothing of terminals:
 * whoever shows the line draws it from `text`.
 */
export class LineEditor {
  private value = '';

  /** The line so far. */
  public get text(): string {
    return this.value;
  }

  public insert(text: string): void {
    this.value += text;
  }

  /** Removes the last character; `false` when the line was empty. */
  public erase(): boolean {
    if (this.value === '') return false;
    const segments = Array.from(
      GRAPHEMES.segment(this.value),
      (part) => part.segment,
    );
    segments.pop();
    this.value = segments.join('');
    return true;
  }

  /** The line, which is then empty again. */
  public take(): string {
    const line = this.value;
    this.value = '';
    return line;
  }
}
