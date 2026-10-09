import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { initStore } from '.';
import { exportUser, importUser, parseJsonl, toJsonl } from './transfer';

const USAGE = `Usage:
  export <userId> --out <file>             write one user's data as JSONL (owner-only file, never overwritten)
  import --in <file> --as-user <userId> [--replace]
                                           load a JSONL file under a user id; refuses a user that has data unless --replace

The backend comes from the environment: STORE=dynamodb with DYNAMODB_TABLE (and your AWS credentials),
or STORE=sqlite with SQLITE_PATH. The export holds financial data: keep it private and never commit it.`;

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      in: { type: 'string' },
      'as-user': { type: 'string' },
      replace: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) return USAGE;

  const [command, userId] = positionals;
  if (command === 'export') {
    if (!userId || !values.out) throw new Error(USAGE);
    const store = await initStore(env);
    const items = await exportUser(store, userId);
    writeFileSync(values.out, toJsonl(items), { mode: 0o600, flag: 'wx' });
    return `Exported ${items.length} items for ${userId} to ${values.out}`;
  }

  if (command === 'import') {
    const asUser = values['as-user'];
    if (!values.in || !asUser) throw new Error(USAGE);
    const items = parseJsonl(readFileSync(values.in, 'utf8'));
    const store = await initStore(env);
    const count = await importUser(store, items, { asUser, replace: values.replace });
    return `Imported ${count} items as ${asUser}`;
  }

  throw new Error(USAGE);
}
