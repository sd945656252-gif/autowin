import net from "node:net";

const listenPort = Number(process.argv[2] || 7898);
const targetHost = process.argv[3] || "127.0.0.1";
const targetPort = Number(process.argv[4] || 7897);

const server = net.createServer((client) => {
  const upstream = net.createConnection({ host: targetHost, port: targetPort });
  client.pipe(upstream);
  upstream.pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close);
  upstream.on("error", close);
});

server.on("error", (error) => {
  console.error(`[PodmanProxyForwarder] Failed to listen on 0.0.0.0:${listenPort}`, error);
  process.exit(1);
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`[PodmanProxyForwarder] 0.0.0.0:${listenPort} -> ${targetHost}:${targetPort}`);
});
