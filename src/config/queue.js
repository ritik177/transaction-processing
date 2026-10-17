import IORedis from "ioredis";

let connection;

export function getRedisConnection() {
  if (!connection) {
    const url = process.env.REDIS_URL;

    if (!url) {
      throw new Error("REDIS_URL is not configured");
    }

    connection = new IORedis(url, {
      maxRetriesPerRequest: null
    });

    connection.on("error", (error) => {
      console.error("Redis connection failed:", error.message);
    });
  }

  return connection;
}

export async function closeRedisConnection() {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
