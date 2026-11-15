import { Worker } from "bullmq";
import { redisConfig } from "../config/env.js";
import { persistQueue, type FetchJobPayload } from "../infra/queues.js";
import { GoogleNewsIngestor } from "../ingestors/google-news.ingestor.js";
import { NewsDataIngestor } from "../ingestors/newsdata.ingestor.js";
import { ProMedIngestor } from "../ingestors/promed.ingestor.js";
import { PlaywrightBrowserService } from "../services/browser.service.js";
import { DeduplicationService } from "../services/dedup.service.js";
import type { SignalIngestor } from "../types/ingestor.js";

export function startFetchWorker() {
  const browserService = new PlaywrightBrowserService();
  const deduplicationService = new DeduplicationService();

  const ingestors: Record<FetchJobPayload["source"], SignalIngestor> = {
    GOOGLE_NEWS: new GoogleNewsIngestor(),
    PROMED: new ProMedIngestor(browserService),
    NEWSDATA: new NewsDataIngestor(),
  };

  const worker = new Worker<FetchJobPayload>(
    "fetch-queue",
    async (job) => {
      const { source } = job.data;
      const ingestor = ingestors[source];

      if (!ingestor) {
        throw new Error(`[FetchWorker] Unknown source: ${source}`);
      }

      await deduplicationService.connect();

      if (source === "PROMED") {
        await browserService.init();
      }

      try {
        console.log(`[FetchWorker] Running ${ingestor.name}...`);
        const rawSignals = await ingestor.collect();

        const { newSignals, duplicateCount } =
          await deduplicationService.filterNewSignals(rawSignals);

        if (newSignals.length > 0) {
          await persistQueue.addBulk(
            newSignals.map((signal) => ({
              name: "upsert-signal",
              data: signal,
              opts: { jobId: signal.id },
            })),
          );
        }

        console.log(
          `[FetchWorker] ${ingestor.name}: ${rawSignals.length} harvested, ${newSignals.length} queued, ${duplicateCount} duplicates dropped.`,
        );

        return {
          source,
          harvested: rawSignals.length,
          queued: newSignals.length,
          duplicates: duplicateCount,
        };
      } finally {
        if (source === "PROMED") {
          await browserService.close();
        }
      }
    },
    {
      connection: {
        host: redisConfig.host,
        port: redisConfig.port,
        maxRetriesPerRequest: null,
      },
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[FetchWorker] Job ${job?.id} (${job?.data.source}) failed (attempt ${job?.attemptsMade}):`,
      err,
    );
  });

  const closeAll = async () => {
    await worker.close();
    await browserService.close();
    await deduplicationService.disconnect();
    await persistQueue.close();
  };

  return { worker, closeAll };
}

// Standalone execution: `npx tsx src/workers/fetch.worker.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("[FetchWorker] Listening for jobs on fetch-queue...");
  const { closeAll } = startFetchWorker();

  const shutdown = async () => {
    console.log("[FetchWorker] Shutting down...");
    await closeAll();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
