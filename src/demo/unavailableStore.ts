// Stands in for the server-side stores in the demo build, so the browser bundle never contains the AWS SDK or node:sqlite.
// src/store/index.ts imports them lazily, and the demo never asks for them (it registers a MemoryStore itself).
const unavailable = (): never => {
  throw new Error('This store is not available in the browser demo');
};

export class DynamoStore {
  static fromEnv(): never {
    return unavailable();
  }
}

export class SqliteStore {
  constructor() {
    unavailable();
  }
}
