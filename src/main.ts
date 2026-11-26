import { App } from "./app/game";

const stage = document.getElementById("stage")!;
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ui = document.getElementById("ui")!;

const app = new App(stage, canvas, ui);
void app.start();

// dev-only handle for poking at state from the console
if (import.meta.env.DEV) (window as unknown as { __wf: App }).__wf = app;
