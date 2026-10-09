import { SqliteStore } from '../sqlite';
import { runStoreContract } from './contract';

runStoreContract('SqliteStore (in memory)', {
  create: async () => new SqliteStore(':memory:'),
});
