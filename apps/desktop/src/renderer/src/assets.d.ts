// Images imported from the renderer resolve to a URL bundled by Vite.
declare module '*.png' {
  const url: string;
  export default url;
}
