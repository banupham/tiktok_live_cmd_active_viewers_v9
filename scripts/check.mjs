import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "a.mjs",
  "sync_profile.mjs",
  "src/index.mjs",
  "src/collector/dom_collector.mjs",
  "src/core/event_bus.mjs",
  "src/core/event_normalizer.mjs",
  "src/storage/jsonl_writer.mjs",
  "src/transports/http_gateway.mjs",
  "src/transports/webhook_dispatcher.mjs",
  "examples/node_sse_client.mjs",
  "examples/node_webhook_receiver.mjs",
];

let failed = false;

for (const relativePath of files) {
  const result = spawnSync(
    process.execPath,
    ["--check", path.join(root, relativePath)],
    { stdio: "inherit" }
  );

  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);
console.log(`Đã kiểm tra cú pháp ${files.length} file JavaScript.`);
