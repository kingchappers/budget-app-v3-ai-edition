import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../../infra', file), 'utf8');

describe('AWS wiring for POST /mcp', () => {
  it('routes POST /mcp to the API Lambda integration', () => {
    const tf = read('api-lambda.tf');
    expect(tf).toMatch(
      /resource "aws_apigatewayv2_route" "mcp" \{[^}]*route_key = "POST \/mcp"[^}]*integrations\/\$\{aws_apigatewayv2_integration\.api_lambda\.id\}/s,
    );
  });

  it('throttles POST /mcp at 5 per second with a burst of 10', () => {
    const tf = read('lambda.tf');
    expect(tf).toMatch(
      /route_settings \{[^}]*route_key\s*=\s*"POST \/mcp"[^}]*throttling_rate_limit\s*=\s*5\b[^}]*throttling_burst_limit\s*=\s*10\b/s,
    );
  });
});
