import { MemoryStore } from '../memory';
import { runStoreContract } from './contract';

runStoreContract('MemoryStore', {
  create: async () => new MemoryStore(),
});
