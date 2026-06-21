import net from "node:net";
import { spawn } from "node:child_process";

const listenPort = Number(process.argv[2] || 3000);
const containerName = process.argv[3] || "jiying_jiying-web_1";
const targetHost = process.argv[4] || "127.0.0.1";
const targetPort = Number(process.argv[5] || 3000);
const listenHost = process.argv[6] || "0.0.0.0";

const bridgeScript = [
  "const net=require('node:net');",
  `const socket=net.connect(${targetPort}, ${JSON.stringify(targetHost)});`,
  "process.stdin.pipe(socket);",
  "socket.pipe(process.stdout);",
  "socket.on('error',()=>process.exit(1));",
  "process.stdin.on('error',()=>{});",
  "process.stdout.on('error',()=>{});",
].join("");

const server = net.createServer((client) => {
  const bridge = spawn(
    "podman",
    ["exec", "-i", containerName, "node", "-e", bridgeScript],
    { stdio: ["pipe", "pipe", "ignore"] },
  );

  client.pipe(bridge.stdin);
  bridge.stdout.pipe(client);

  const close = () => {
    client.destroy();
    bridge.kill();
  };

  client.on("error", close);
  bridge.on("error", close);
  bridge.on("exit", () => client.destroy());
});

server.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

server.listen(listenPort, listenHost, () => {
  console.log(
    `Forwarding ${listenHost}:${listenPort} -> ${containerName}:${targetHost}:${targetPort}`,
  );
});
