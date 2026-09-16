import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { WorkerCommand, WorkerResult } from '../sync/commands';

const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'eu-west-2' });

function functionName(): string {
  const name = process.env.WORKER_FUNCTION_NAME;
  if (!name) throw new Error('Missing required environment variable WORKER_FUNCTION_NAME');
  return name;
}

const encode = (command: WorkerCommand): Uint8Array => new TextEncoder().encode(JSON.stringify(command));

export async function invokeWorker<T>(command: WorkerCommand): Promise<WorkerResult<T>> {
  const result = await lambda.send(new InvokeCommand({
    FunctionName: functionName(),
    InvocationType: 'RequestResponse',
    Payload: encode(command),
  }));
  if (result.FunctionError || !result.Payload) {
    console.error(JSON.stringify({ event: 'worker.invoke_failed', command: command.command, functionError: result.FunctionError ?? 'NO_PAYLOAD' }));
    return { ok: false, error: 'UPSTREAM', message: 'The bank service is unavailable' };
  }
  return JSON.parse(new TextDecoder().decode(result.Payload)) as WorkerResult<T>;
}

export async function invokeWorkerAsync(command: WorkerCommand): Promise<void> {
  await lambda.send(new InvokeCommand({
    FunctionName: functionName(),
    InvocationType: 'Event',
    Payload: encode(command),
  }));
}
