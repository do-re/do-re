// The bundler (esbuild, --loader:.csv=text) inlines CSV files as strings.
declare module '*.csv' {
  const text: string;
  export default text;
}
