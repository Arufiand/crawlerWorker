import { fetchQueue } from "./infra/queues.js";
import { startFetchWorker } from "./workers/fetch.worker";
import { startPersistWorker } from "./workers/persist.worker";

async function registerSchedules() {
  await fetchQueue.upsertJobScheduler(
    "schedule-google-news",
    { pattern: "*/30 * * * *" },
    { name: "fetch-google-news", data: { source: "GOOGLE_NEWS" } },
  );

  await fetchQueue.upsertJobScheduler(
    "schedule-newsdata",
    { pattern: "0 * * * *" },
    { name: "fetch-newsdata", data: { source: "NEWSDATA" } },
  );

  await fetchQueue.upsertJobScheduler(
    "schedule-promed",
    { pattern: "0 */2 * * *" },
    { name: "fetch-promed", data: { source: "PROMED" } },
  );
  console.log("[Scheduler] Repeatable fetch schedules registered.");
}

async function bootstrap() {
  await registerSchedules();

  const { closeAll: closeFetchWorker } = startFetchWorker();
  const persistWorker = startPersistWorker();

  console.log("[System] Outbreak ingestion workers are running.");

  const shutdown = async () => {
    console.log("\n[System] Gracefully shutting down workers...");
    await closeFetchWorker();
    await persistWorker.close();
    await fetchQueue.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((err) => {
  console.error("[System] Fatal startup error:", err);
  process.exit(1);
});
