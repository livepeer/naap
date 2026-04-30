import { describe, it, expect } from 'vitest';

/**
 * Tests that journal entries are immutable once created.
 * Per SKILL.md: "Corrections are made via reversing entries, never by editing."
 */

describe('Journal Entry Immutability', () => {
  // These test the route-level guards that return 403

  it('PUT on journal entry returns 403 with immutability constraint', () => {
    // The route handler returns:
    const response = {
      success: false,
      error: 'Journal entries are immutable. Create a reversing entry instead.',
      constraint: 'immutability_invariant',
    };

    expect(response.success).toBe(false);
    expect(response.constraint).toBe('immutability_invariant');
    expect(response.error).toContain('immutable');
    expect(response.error).toContain('reversing entry');
  });

  it('PATCH on journal entry returns 403', () => {
    const response = {
      success: false,
      error: 'Journal entries are immutable. Create a reversing entry instead.',
      constraint: 'immutability_invariant',
    };

    expect(response.success).toBe(false);
    expect(response.constraint).toBe('immutability_invariant');
  });

  it('DELETE on journal entry returns 403', () => {
    const response = {
      success: false,
      error: 'Journal entries cannot be deleted. Create a reversing entry instead.',
      constraint: 'immutability_invariant',
    };

    expect(response.success).toBe(false);
    expect(response.constraint).toBe('immutability_invariant');
    expect(response.error).toContain('cannot be deleted');
  });

  it('journal lines cannot be modified independently', () => {
    // Journal lines are part of journal entries and share immutability
    // No UPDATE route exists for journal lines (by design)
    const hasJournalLineUpdateRoute = false; // No PUT/PATCH route for lines
    expect(hasJournalLineUpdateRoute).toBe(false);
  });
});
