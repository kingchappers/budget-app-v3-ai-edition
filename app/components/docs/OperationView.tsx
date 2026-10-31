import { Code, Stack, Text, Title } from '@mantine/core';
import { exampleCurl, resolveRef, schemaFields, type ApiMediaType, type ApiParameter, type ApiSpec, type OperationEntry } from '~/lib/apiDocs';
import { CopyCurl } from './CopyCurl';
import { FieldList } from './FieldList';
import { InlineSpans, InlineText } from './InlineText';

const codeBoxStyle = { overflowX: 'auto', maxWidth: '100%' } as const;
const wrappedCodeStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: '100%' } as const;

interface NamedExample {
  summary?: string;
  value: unknown;
}

function requestExamples(body: ApiMediaType | undefined): NamedExample[] {
  if (!body) return [];
  if (body.example !== undefined) return [{ value: body.example }];
  return Object.values(body.examples ?? {}).flatMap((e) => (e.value === undefined ? [] : [{ summary: e.summary, value: e.value }]));
}


function ParameterList({ parameters }: { parameters: ApiParameter[] }) {
  return (
    <Stack gap="xs">
      <Title order={4} size="h6">Parameters</Title>
      <FieldList
        fields={parameters.map((p) => ({
          name: p.name,
          type: `${p.in}, ${typeof p.schema?.type === 'string' ? p.schema.type : 'any'}`,
          required: p.required ?? false,
          description: p.description,
        }))}
      />
    </Stack>
  );
}

export function OperationView({ spec, entry }: { spec: ApiSpec; entry: OperationEntry }): React.JSX.Element {
  const { operation } = entry;
  const body = operation.requestBody?.content?.['application/json'];
  const bodyFields = body?.schema ? schemaFields(spec, body.schema) : [];
  const responses = Object.entries(operation.responses ?? {});
  const examples = requestExamples(body);
  const curl = exampleCurl({ method: entry.method, path: entry.path, body: body ? (examples[0]?.value ?? {}) : undefined });

  return (
    <Stack gap="md">
      {operation.description && <div><InlineText text={operation.description} /></div>}
      {entry.parameters.length > 0 && <ParameterList parameters={entry.parameters} />}
      {bodyFields.length > 0 && (
        <Stack gap="xs">
          <Title order={4} size="h6">Request fields</Title>
          <FieldList fields={bodyFields} />
        </Stack>
      )}
      {examples.length > 0 && (
        <Stack gap="xs">
          <Title order={4} size="h6">Request example</Title>
          {examples.map((example, i) => (
            <Stack key={i} gap={4}>
              {example.summary && <Text size="sm">{example.summary}</Text>}
              <Code
                block
                style={codeBoxStyle}
                tabIndex={0}
                role="group"
                aria-label={example.summary ? `Request example: ${example.summary}` : 'Request example'}
              >
                {JSON.stringify(example.value, null, 2)}
              </Code>
            </Stack>
          ))}
        </Stack>
      )}
      {responses.length > 0 && (
        <Stack gap="xs">
          <Title order={4} size="h6">Responses</Title>
          {responses.map(([status, response]) => (
            <Text key={status} size="sm">
              <Code>{status}</Code>{' '}
              <InlineSpans text={(response.$ref ? resolveResponse(spec, response.$ref) : response.description) ?? ''} />
            </Text>
          ))}
        </Stack>
      )}
      <Stack gap="xs">
        <Title order={4} size="h6">Example</Title>
        <Code block style={wrappedCodeStyle}>{curl}</Code>
        <CopyCurl command={curl} />
      </Stack>
    </Stack>
  );
}

function resolveResponse(spec: ApiSpec, ref: string): string | undefined {
  const name = ref.replace('#/components/responses/', '');
  return spec.components?.responses?.[name]?.description;
}
