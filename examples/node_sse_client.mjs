const endpoint =
  process.env.TIKTOK_SSE_URL ||
  "http://127.0.0.1:8787/api/events";

console.log(`Đang kết nối SSE: ${endpoint}`);

const response = await fetch(endpoint, {
  headers: { Accept: "text/event-stream" },
});

if (!response.ok || !response.body) {
  throw new Error(`Không kết nối được: HTTP ${response.status}`);
}

const decoder = new TextDecoder();
let buffer = "";
let eventName = "message";
let dataLines = [];

function dispatchBlock() {
  if (!dataLines.length) {
    eventName = "message";
    return;
  }

  const rawData = dataLines.join("\n");

  if (eventName === "tiktok-event") {
    const event = JSON.parse(rawData);
    console.log(
      `[${event.eventType}]`,
      event.user.displayName,
      event.payload
    );
  } else {
    console.log(`[SSE ${eventName}]`, rawData);
  }

  eventName = "message";
  dataLines = [];
}

for await (const chunk of response.body) {
  buffer += decoder.decode(chunk, { stream: true });

  while (true) {
    const lineEnd = buffer.indexOf("\n");
    if (lineEnd < 0) break;

    const line = buffer.slice(0, lineEnd).replace(/\r$/, "");
    buffer = buffer.slice(lineEnd + 1);

    if (!line) {
      dispatchBlock();
      continue;
    }

    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
}
