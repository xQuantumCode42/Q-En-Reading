import { parentPort, workerData } from "node:worker_threads";
import { extractArticle } from "./article-import";

try {
  parentPort!.postMessage({
    result: extractArticle(workerData.html, workerData.source),
  });
} catch (error) {
  parentPort!.postMessage({
    error:
      error instanceof Error ? error.message : "無法擷取正文，請手動貼上。",
  });
}
