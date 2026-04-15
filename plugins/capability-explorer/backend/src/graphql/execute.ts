import { buildSchema, graphql } from 'graphql';
import type { HandlerContext } from '../types.js';
import { SCHEMA_SDL } from './schema.js';
import { createResolvers } from './resolvers.js';

let compiledSchema: ReturnType<typeof buildSchema> | null = null;

function getSchema() {
  if (!compiledSchema) {
    compiledSchema = buildSchema(SCHEMA_SDL);
  }
  return compiledSchema;
}

export async function executeGraphQL(
  query: string,
  variables: Record<string, unknown> | undefined,
  ctx: HandlerContext,
): Promise<{ data?: unknown; errors?: unknown[] }> {
  const schema = getSchema();
  const rootValue = createResolvers(ctx);

  const result = await graphql({
    schema,
    source: query,
    rootValue,
    variableValues: variables,
  });

  return {
    data: result.data,
    errors: result.errors?.map((e) => ({
      message: e.message,
      locations: e.locations,
      path: e.path,
    })),
  };
}
