import { Code, Stack, Text, Title } from '@mantine/core';
import { exampleCurl, resolveRef, schemaFields, type ApiParameter, type ApiSpec, type OperationEntry } from '~/lib/apiDocs';
import { CopyCurl } from './CopyCurl';
import { FieldList } from './FieldList';
import { InlineText } from './InlineText';

const codeBoxStyle = { overflowX: 'auto', maxWidth: '100%' } as const;

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
  const curl = exampleCurl({ method: entry.method, path: entry.path, body: body?.example });

  return (
    <Stack gap="md">
      {operation.description && <div><InlineText text={operation.description} /></div>}
      {operation.parameters && operation.parameters.length > 0 && <ParameterList parameters={operation.parameters} />}
      {bodyFields.length > 0 && (
        <Stack gap="xs">
          <Title order={4} size="h6">Request fields</Title>
          <FieldList fields={bodyFields} />
        </Stack>
      )}
      {body?.example !== undefined && (
        <Stack gap="xs">
          <Title order={4} size="h6">Request example</Title>
          <Code block style={codeBoxStyle}>{JSON.stringify(body.example, null, 2)}</Code>
        </Stack>
      )}
      {responses.length > 0 && (
        <Stack gap="xs">
          <Title order={4} size="h6">Responses</Title>
          {responses.map(([status, response]) => (
            <Text key={status} size="sm">
              <Code>{status}</Code> {(response.$ref ? resolveResponse(spec, response.$ref) : response.description) ?? ''}
            </Text>
          ))}
        </Stack>
      )}
      <Stack gap="xs">
        <Title order={4} size="h6">Example</Title>
        <Code block style={codeBoxStyle}>{curl}</Code>
        <CopyCurl command={curl} />
      </Stack>
    </Stack>
  );
}

function resolveResponse(spec: ApiSpec, ref: string): string | undefined {
  const name = ref.replace('#/components/responses/', '');
  return spec.components?.responses?.[name]?.description;
}
