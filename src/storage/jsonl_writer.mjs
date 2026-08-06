import fs from "node:fs";
import path from "node:path";

export class JsonlWriter {
  constructor({ filePath = null } = {}) {
    this.filePath = filePath ? path.resolve(filePath) : null;

    if (this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }
  }

  write(event) {
    if (!this.filePath) return;

    fs.appendFileSync(
      this.filePath,
      `${JSON.stringify(event)}\n`,
      "utf8"
    );
  }
}
