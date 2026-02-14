import { StrictMode } from 'react';
import { DefaultLayout } from "../layout/DefaultLayout";
import { Text } from '@mantine/core';
export function Welcome() {

  return (
    <StrictMode>
      <DefaultLayout>
        <Text>This is text as a child node to the default layout</Text>
      </DefaultLayout>
    </StrictMode>
  );
}