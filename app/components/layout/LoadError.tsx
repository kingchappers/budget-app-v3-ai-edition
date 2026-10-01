import { Alert, Button, Text } from '@mantine/core';

export interface LoadErrorProps {
  // What failed to load, in plain words: "transactions", "pots", "recurring items".
  thing: string;
  onRetry: () => void;
}

export function LoadError({ thing, onRetry }: LoadErrorProps) {
  return (
    <Alert color="danger" title={`We couldn't load your ${thing}`}>
      <Text mb="sm">Nothing has been lost. Check your connection and try again.</Text>
      <Button onClick={onRetry}>Try again</Button>
    </Alert>
  );
}
