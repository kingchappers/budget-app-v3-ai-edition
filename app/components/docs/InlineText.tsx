import { Code, List, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', items: list });
    list = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flushParagraph();
      flushList();
    } else if (line.startsWith('## ')) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', text: line.slice(3) });
    } else if (line.startsWith('- ')) {
      flushParagraph();
      list ??= [];
      list.push(line.slice(2));
    } else if (list) {
      list[list.length - 1] += ` ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

function renderSpans(text: string): ReactNode[] {
  const parts = text.split('`');
  const strayBacktick = parts.length % 2 === 0;
  return parts.map((part, i) => {
    if (i % 2 === 1 && i < parts.length - 1) return <Code key={i}>{part}</Code>;
    return strayBacktick && i === parts.length - 1 ? `\`${part}` : part;
  });
}

export function InlineSpans({ text }: { text: string }): React.JSX.Element {
  return <>{renderSpans(text)}</>;
}

export function InlineText({ text, headingOrder = 4 }: { text: string; headingOrder?: 3 | 4 }) {
  return (
    <>
      {parseBlocks(text).map((block, i) => {
        if (block.kind === 'heading') {
          return <Title key={i} order={headingOrder} mt="md" mb="xs">{block.text}</Title>;
        }
        if (block.kind === 'list') {
          return (
            <List key={i} size="sm" mb="xs" listStyleType="disc">
              {block.items.map((item, j) => (
                <List.Item key={j}>{renderSpans(item)}</List.Item>
              ))}
            </List>
          );
        }
        return <Text key={i} size="sm" mb="xs">{renderSpans(block.text)}</Text>;
      })}
    </>
  );
}
