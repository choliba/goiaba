// The pages set CSS custom properties inline (a lane's color, the number of
// lanes): React's style type learns that they exist.

/** A CSS custom property: `--c`, `--lanes`. */
export type CustomProperty = `--${string}`;

declare module 'react' {
  interface CSSProperties {
    [property: CustomProperty]: string | undefined;
  }
}
