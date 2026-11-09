const { spawn } = require("node:child_process");
const http = require("node:http");
const children = [];
const run = (file, args) => {
  const p = spawn(process.execPath, [file, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  children.push(p);
  return p;
};
const compiler = run("node_modules/typescript/bin/tsc", [
  "-p",
  "tsconfig.electron.json",
]);
compiler.on("exit", (code) => {
  if (code) process.exit(code);
  const vite = run("node_modules/vite/bin/vite.js", []);
  const poll = setInterval(() => {
    http
      .get("http://127.0.0.1:5173", (res) => {
        res.resume();
        if (res.statusCode === 200) {
          clearInterval(poll);
          const env = { ...process.env, READING_DESK_DEV: "1" };
          delete env.ELECTRON_RUN_AS_NODE;
          const app = spawn(require("electron"), ["."], {
            stdio: "inherit",
            env,
          });
          children.push(app);
          app.on("exit", () => {
            vite.kill();
            process.exit();
          });
        }
      })
      .on("error", () => {});
  }, 400);
  vite.on("exit", (code) => {
    clearInterval(poll);
    children.forEach((p) => p.kill());
    process.exit(code ?? 0);
  });
});
process.on("SIGINT", () => {
  children.forEach((p) => p.kill());
  process.exit();
});
