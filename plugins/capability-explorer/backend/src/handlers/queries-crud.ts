import type { ApiResponse, CapabilityQueryRecord } from '../types.js';
import { CreateCapabilityQuerySchema, UpdateCapabilityQuerySchema } from '../types.js';
import type { QueryScope } from '../queries.js';
import { createQuery, getQuery, updateQuery, deleteQuery } from '../queries.js';

export async function handleCreateQuery(
  body: unknown,
  scope: QueryScope,
): Promise<ApiResponse<CapabilityQueryRecord>> {
  const parsed = CreateCapabilityQuerySchema.safeParse(body);
  if (!parsed.success) {
    return {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues.map((i) => i.message).join('; ') },
    };
  }

  try {
    const query = await createQuery(parsed.data, scope);
    return { success: true, data: query };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create query';
    if (msg.includes('Unique constraint')) {
      return { success: false, error: { code: 'CONFLICT', message: 'A query with this slug already exists' } };
    }
    return { success: false, error: { code: 'INTERNAL_ERROR', message: msg } };
  }
}

export async function handleGetQuery(
  id: string,
  scope: QueryScope,
): Promise<ApiResponse<CapabilityQueryRecord>> {
  try {
    const query = await getQuery(id, scope);
    if (!query) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Query not found' } };
    }
    return { success: true, data: query };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}

export async function handleUpdateQuery(
  id: string,
  body: unknown,
  scope: QueryScope,
): Promise<ApiResponse<CapabilityQueryRecord>> {
  const parsed = UpdateCapabilityQuerySchema.safeParse(body);
  if (!parsed.success) {
    return {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues.map((i) => i.message).join('; ') },
    };
  }

  try {
    const query = await updateQuery(id, parsed.data, scope);
    if (!query) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Query not found' } };
    }
    return { success: true, data: query };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}

export async function handleDeleteQuery(
  id: string,
  scope: QueryScope,
): Promise<ApiResponse<{ deleted: boolean }>> {
  try {
    const deleted = await deleteQuery(id, scope);
    if (!deleted) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Query not found' } };
    }
    return { success: true, data: { deleted: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
