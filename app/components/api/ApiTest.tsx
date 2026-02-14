import { useState } from 'react';
import { Button, Card, Text, Stack, Badge, Code } from '@mantine/core';
import { useProtectedApi } from '../../hooks/useProtectedApi';

export function ApiTest() {
  const { request } = useProtectedApi();
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testApi = async (endpoint: string) => {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const data = await request(endpoint);
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Card.Section withBorder inheritPadding py="md">
        <Text>API Test</Text>
      </Card.Section>

      <Stack gap="md">
        <Stack gap="sm">
          <Button
            onClick={() => testApi('/api/test')}
            loading={loading}
            fullWidth
          >
            Test /api/test Endpoint
          </Button>
          <Button
            onClick={() => testApi('/api/user-info')}
            loading={loading}
            fullWidth
            variant="light"
          >
            Get /api/user-info
          </Button>
        </Stack>

        {error && (
          <div style={{ padding: '12px', backgroundColor: '#ffe0e0', borderRadius: '4px' }}>
            <Text size="sm" color="red">
              <Badge color="red">Error</Badge> {error}
            </Text>
          </div>
        )}

        {response && (
          <div style={{ padding: '12px', backgroundColor: '#e0f2f1', borderRadius: '4px' }}>
            <Text size="sm" mb="xs">
              Response:
            </Text>
            <Code block>{JSON.stringify(response, null, 2)}</Code>
          </div>
        )}
      </Stack>
    </Card>
  );
}
