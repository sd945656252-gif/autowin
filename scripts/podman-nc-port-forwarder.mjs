import net from "node:net";
import { spawn } from "node:child_process";

const listenPort = Number(process.argv[2]);
const containerName = process.argv[3];
const targetHost = process.argv[4] || "127.0.0.1";
const targetPort = Number(process.argv[5]);

if (!listenPort || !containerName || !targetPort) {
  console.error("Usage: node podman-nc-port-forwarder.mjs <listenPort> <containerName> <targetHost> <targetPort>");
  process.exit(1);
}

const server = net.createServer((client) => {
  const bridge = spawn(
    "podman",
    ["exec", "-i", containerName, "nc", targetHost, String(targetPort)],
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

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`Forwarding 127.0.0.1:${listenPort} -> ${containerName}:${targetHost}:${targetPort}`);
});
