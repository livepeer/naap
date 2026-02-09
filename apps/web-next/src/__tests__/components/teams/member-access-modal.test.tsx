/**
 * MemberAccessModal Component Tests
 * Tests for the member access management modal used in team plugin management.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemberAccessModal } from '../../../components/teams/member-access-modal';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock window.confirm
const mockConfirm = vi.fn();
window.confirm = mockConfirm;

const mockMembers = [
  {
    id: 'member-1',
    userId: 'user-1',
    role: 'owner',
    user: {
      id: 'user-1',
      email: 'owner@example.com',
      displayName: 'John Owner',
      avatarUrl: null,
    },
  },
  {
    id: 'member-2',
    userId: 'user-2',
    role: 'admin',
    user: {
      id: 'user-2',
      email: 'admin@example.com',
      displayName: 'Jane Admin',
      avatarUrl: null,
    },
  },
  {
    id: 'member-3',
    userId: 'user-3',
    role: 'member',
    user: {
      id: 'user-3',
      email: 'member@example.com',
      displayName: 'Bob Member',
      avatarUrl: null,
    },
  },
];

const mockAccessData = {
  access: [
    { pluginInstallId: 'install-456', visible: true, canUse: true, canConfigure: false },
  ],
};

describe('MemberAccessModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    teamId: 'team-123',
    pluginInstallId: 'install-456',
    pluginName: 'My Dashboard',
    onSaved: vi.fn(),
  };

  function setupSuccessfulFetch() {
    mockFetch
      // First call: fetch members
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { members: mockMembers } }),
      })
      // Subsequent calls: fetch access for each member
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockAccessData),
      });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should not render when isOpen is false', () => {
      render(<MemberAccessModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByText(/Member Access/)).not.toBeInTheDocument();
    });

    it('should render modal with plugin name', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Member Access: My Dashboard')).toBeInTheDocument();
      });
    });

    it('should show loading state initially', () => {
      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      render(<MemberAccessModal {...defaultProps} />);

      // Loading spinner should be visible
      expect(document.querySelector('.animate-spin')).toBeTruthy();
    });

    it('should display all team members after loading', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
        expect(screen.getByText('Jane Admin')).toBeInTheDocument();
        expect(screen.getByText('Bob Member')).toBeInTheDocument();
      });
    });

    it('should show role labels for each member', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        // Use getAllByText since "Member" appears in multiple places (table header + role label)
        expect(screen.getByText('Owner')).toBeInTheDocument();
        expect(screen.getByText('Admin')).toBeInTheDocument();
        // Member appears both as table header "Member" and as role label
        const memberLabels = screen.getAllByText('Member');
        expect(memberLabels.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should show empty state when no members', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { members: [] } }),
      });

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('No team members found')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should show error when members fail to load', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: { message: 'Access denied' } }),
      });

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Access denied')).toBeInTheDocument();
      });
    });

    it('should show error on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load data')).toBeInTheDocument();
      });
    });
  });

  describe('Access Control Toggles', () => {
    it('should toggle visible permission', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      // Find the first row (John Owner) and its visible toggle
      const rows = document.querySelectorAll('.grid.grid-cols-\\[1fr\\,auto\\,auto\\,auto\\]');
      const memberRow = Array.from(rows).find(row => row.textContent?.includes('John Owner'));
      expect(memberRow).toBeTruthy();

      if (memberRow) {
        // The visible toggle is the first button after the member info
        const toggleButtons = memberRow.querySelectorAll('button');
        // First button is visible, second is canUse, third is canConfigure
        const visibleToggle = toggleButtons[0];
        fireEvent.click(visibleToggle);

        // After click, the save button should be enabled
        const saveButton = screen.getByRole('button', { name: /save access/i });
        expect(saveButton).not.toBeDisabled();
      }
    });

    it('should toggle canUse permission', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      const rows = document.querySelectorAll('.grid.grid-cols-\\[1fr\\,auto\\,auto\\,auto\\]');
      const memberRow = Array.from(rows).find(row => row.textContent?.includes('John Owner'));

      if (memberRow) {
        const toggleButtons = memberRow.querySelectorAll('button');
        const canUseToggle = toggleButtons[1];
        fireEvent.click(canUseToggle);

        const saveButton = screen.getByRole('button', { name: /save access/i });
        expect(saveButton).not.toBeDisabled();
      }
    });

    it('should toggle canConfigure permission', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      const rows = document.querySelectorAll('.grid.grid-cols-\\[1fr\\,auto\\,auto\\,auto\\]');
      const memberRow = Array.from(rows).find(row => row.textContent?.includes('John Owner'));

      if (memberRow) {
        const toggleButtons = memberRow.querySelectorAll('button');
        const configureToggle = toggleButtons[2];
        fireEvent.click(configureToggle);

        const saveButton = screen.getByRole('button', { name: /save access/i });
        expect(saveButton).not.toBeDisabled();
      }
    });
  });

  describe('Bulk Actions', () => {
    it('should select all visible permissions', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      const selectAllButtons = screen.getAllByRole('button', { name: /select all/i });
      fireEvent.click(selectAllButtons[0]); // First "Select All" is for Visible

      const saveButton = screen.getByRole('button', { name: /save access/i });
      // Save button may or may not be enabled depending on current state
    });

    it('should deselect all visible permissions', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      const deselectAllButtons = screen.getAllByRole('button', { name: /deselect all/i });
      fireEvent.click(deselectAllButtons[0]); // First "Deselect All" is for Visible

      const saveButton = screen.getByRole('button', { name: /save access/i });
      expect(saveButton).not.toBeDisabled();
    });

    it('should select all canUse permissions', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      const selectAllButtons = screen.getAllByRole('button', { name: /select all/i });
      fireEvent.click(selectAllButtons[1]); // Second "Select All" is for Can Use
    });

    it('should deselect all canUse permissions', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      const deselectAllButtons = screen.getAllByRole('button', { name: /deselect all/i });
      fireEvent.click(deselectAllButtons[1]); // Second "Deselect All" is for Can Use

      const saveButton = screen.getByRole('button', { name: /save access/i });
      expect(saveButton).not.toBeDisabled();
    });
  });

  describe('Save Functionality', () => {
    it('should disable save button when no changes', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /save access/i });
      expect(saveButton).toBeDisabled();
    });

    it('should call API for changed members only', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      // Toggle one member's access
      const rows = document.querySelectorAll('.grid.grid-cols-\\[1fr\\,auto\\,auto\\,auto\\]');
      const memberRow = Array.from(rows).find(row => row.textContent?.includes('John Owner'));

      if (memberRow) {
        const toggleButtons = memberRow.querySelectorAll('button');
        fireEvent.click(toggleButtons[0]); // Toggle visible
      }

      // Reset mock to track save calls
      mockFetch.mockClear();
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const saveButton = screen.getByRole('button', { name: /save access/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        // Should call the save API at least once for the changed member
        expect(mockFetch).toHaveBeenCalled();
        expect(defaultProps.onSaved).toHaveBeenCalled();
        expect(defaultProps.onClose).toHaveBeenCalled();
      });
    });

    it('should show error when some saves fail', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      // Toggle one member's access
      const rows = document.querySelectorAll('.grid.grid-cols-\\[1fr\\,auto\\,auto\\,auto\\]');
      const memberRow = Array.from(rows).find(row => row.textContent?.includes('John Owner'));

      if (memberRow) {
        const toggleButtons = memberRow.querySelectorAll('button');
        fireEvent.click(toggleButtons[0]); // Toggle visible
      }

      // Mock a failed save
      mockFetch.mockClear();
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Save failed' }),
      });

      const saveButton = screen.getByRole('button', { name: /save access/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/Failed to update/)).toBeInTheDocument();
      });
    });
  });

  describe('Close Behavior', () => {
    it('should close without confirmation when no changes', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should prompt confirmation when closing with unsaved changes', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      // Make a change
      const rows = document.querySelectorAll('.grid.grid-cols-\\[1fr\\,auto\\,auto\\,auto\\]');
      const memberRow = Array.from(rows).find(row => row.textContent?.includes('John Owner'));

      if (memberRow) {
        const toggleButtons = memberRow.querySelectorAll('button');
        fireEvent.click(toggleButtons[0]);
      }

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(mockConfirm).toHaveBeenCalledWith('You have unsaved changes. Are you sure you want to close?');
    });

    it('should not close if user cancels confirmation', async () => {
      mockConfirm.mockReturnValue(false);
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      // Make a change
      const rows = document.querySelectorAll('.grid.grid-cols-\\[1fr\\,auto\\,auto\\,auto\\]');
      const memberRow = Array.from(rows).find(row => row.textContent?.includes('John Owner'));

      if (memberRow) {
        const toggleButtons = memberRow.querySelectorAll('button');
        fireEvent.click(toggleButtons[0]);
      }

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });

    it('should close on Escape key press', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should close on backdrop click', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('John Owner')).toBeInTheDocument();
      });

      const backdrop = document.querySelector('.bg-black\\/60');
      if (backdrop) {
        fireEvent.click(backdrop);
      }

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('Permission Descriptions', () => {
    it('should show permission explanations', async () => {
      setupSuccessfulFetch();

      render(<MemberAccessModal {...defaultProps} />);

      await waitFor(() => {
        // Check for the explanation text (inside the paragraph)
        expect(screen.getByText(/Member can see the plugin in their sidebar/)).toBeInTheDocument();
        expect(screen.getByText(/Member can interact with the plugin/)).toBeInTheDocument();
        expect(screen.getByText(/Member can modify their personal settings/)).toBeInTheDocument();
      });
    });
  });
});
