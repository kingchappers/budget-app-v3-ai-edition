import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Stack, Table, Text } from '@mantine/core';

export interface ChartDataProps {
  // One plain sentence saying what the chart shows.
  summary: string;
  caption: string;
  columns: string[];
  rows: (string | number)[][];
  children: ReactNode;
}

// A chart with a one-line summary beneath it and its numbers available as a real table.
export function ChartData({ summary, caption, columns, rows, children }: ChartDataProps) {
  const [showTable, setShowTable] = useState(false);

  return (
    <Stack gap="xs">
      {children}
      <Text size="sm">{summary}</Text>
      <Button
        variant="subtle"
        size="compact-sm"
        style={{ alignSelf: 'flex-start' }}
        aria-expanded={showTable}
        onClick={() => setShowTable(shown => !shown)}
      >
        {showTable ? 'Hide table' : 'Show as table'}
      </Button>
      {showTable && (
        <Table.ScrollContainer minWidth={280}>
          <Table>
            <Table.Caption>{caption}</Table.Caption>
            <Table.Thead>
              <Table.Tr>
                {columns.map(column => <Table.Th key={column}>{column}</Table.Th>)}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row, index) => (
                <Table.Tr key={index}>
                  {row.map((cell, cellIndex) => (
                    cellIndex === 0 ? <Table.Th key={cellIndex} scope="row">{cell}</Table.Th> : <Table.Td key={cellIndex}>{cell}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
