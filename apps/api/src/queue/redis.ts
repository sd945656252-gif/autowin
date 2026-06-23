import IORedis from "ioredis";

let connection: IORedis | null = null;

export function getRedisUrl() {
  return process.env.REDIS_URL || null;
}

export function getBullMqConnectionOptions() {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;
  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  };
}

export function getRedisConnection() {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;
  if (!connection) {
    connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true
    });
  }
  return connection;
}

export async function closeRedisConnection() {
  if (connection) {
    await connection.quit().catch(() => connection?.disconnect());
    connection = null;
  }
}
