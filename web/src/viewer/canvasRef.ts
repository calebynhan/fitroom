// Holds the WebGL canvas so UI outside <Canvas> (Make it real) can snapshot it.
let canvas: HTMLCanvasElement | null = null;

export function setViewerCanvas(el: HTMLCanvasElement | null): void {
  canvas = el;
}

export function getViewerCanvas(): HTMLCanvasElement | null {
  return canvas;
}
