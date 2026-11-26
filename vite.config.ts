import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vitest/config";
import { appendLog, pruneLogs, readSave, writeSave } from "./dev/datastore.ts";

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => (s += c));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

/** Dev-only endpoints so browser runs read and write %APPDATA%/Wordfront like the desktop build. */
function datastore(): Plugin {
  return {
    name: "wordfront-datastore",
    configureServer(server) {
      server.middlewares.use("/__wf", (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", "http://x");
        const send = (code: number, text = "") => {
          res.statusCode = code;
          res.end(text);
        };
        void (async () => {
          try {
            if (url.pathname === "/save" && req.method === "GET") {
              const s = readSave();
              return s === null ? send(204) : send(200, s);
            }
            if (url.pathname === "/save" && req.method === "PUT") {
              writeSave(await body(req));
              return send(204);
            }
            if (url.pathname === "/log" && req.method === "POST") {
              appendLog(url.searchParams.get("file") ?? "", await body(req));
              return send(204);
            }
            if (url.pathname === "/prune" && req.method === "POST") {
              const n = pruneLogs(Number(url.searchParams.get("runs")), Number(url.searchParams.get("bytes")));
              return send(200, String(n));
            }
            send(404);
          } catch (err) {
            send(400, String(err));
          }
        })();
      });
    },
  };
}

export default defineConfig({
  plugins: [datastore()],
  server: { port: 5199, strictPort: true },
  build: { target: "es2022" },
  test: { include: ["tests/**/*.test.ts"] },
});
