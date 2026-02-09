/**
 * PluginConfigModal Component Tests
 * Tests for the plugin configuration modal used in team management.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginConfigModal } from '../../../components/teams/plugin-config-modal';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock window.confirm
const mockConfirm = vi.fn();
window.confirm = mockConfirm;

describe('PluginConfigModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    teamId: 'team-123',
    pluginInstallId: 'install-456',
    pluginName: 'My Dashboard',
    onSaved: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should not render when isOpen is false', () => {
      render(<PluginConfigModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByText('Configure: My Dashboard')).not.toBeInTheDocument();
    });

    it('should render modal with plugin name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sharedConfig: {} }),
      });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Configure: My Dashboard')).toBeInTheDocument();
      });
    });

    it('should show loading state initially', () => {
      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      render(<PluginConfigModal {...defaultProps} />);

      // Loading spinner should be visible (has animate-spin class)
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeTruthy();
    });

    it('should display config in textarea after loading', async () => {
      const config = { metabaseUrl: 'https://example.com', theme: 'dark' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sharedConfig: config }),
      });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        const textarea = screen.getByRole('textbox');
        expect(textarea).toHaveValue(JSON.stringify(config, null, 2));
      });
    });
  });

  describe('Error Handling', () => {
    it('should show error when config fails to load', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Permission denied' }),
      });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Permission denied')).toBeInTheDocument();
      });
    });

    it('should show error on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load configuration')).toBeInTheDocument();
      });
    });

    it('should show JSON parse error for invalid input', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sharedConfig: {} }),
      });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '{ invalid json' } });

      expect(screen.getByText('Invalid JSON format')).toBeInTheDocument();
    });
  });

  describe('Save Functionality', () => {
    it('should disable save button when no changes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sharedConfig: { key: 'value' } }),
      });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /save configuration/i });
      expect(saveButton).toBeDisabled();
    });

    it('should enable save button when config changes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sharedConfig: {} }),
      });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '{ "newKey": "newValue" }' } });

      const saveButton = screen.getByRole('button', { name: /save configuration/i });
      expect(saveButton).not.toBeDisabled();
    });

    it('should call API and callbacks on successful save', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ sharedConfig: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '{ "updated": true }' } });

      const saveButton = screen.getByRole('button', { name: /save configuration/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/v1/teams/team-123/plugins/install-456/config',
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ sharedConfig: { updated: true } }),
          })
        );
        expect(defaultProps.onSaved).toHaveBeenCalled();
        expect(defaultProps.onClose).toHaveBeenCalled();
      });
    });

    it('should show error when save fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ sharedConfig: {} }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: 'Save failed' }),
        });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '{ "test": 1 }' } });

      const saveButton = screen.getByRole('button', { name: /save configuration/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
      });
    });
  });

  describe('Close Behavior', () => {
    it('should close without confirmation when no changes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sharedConfig: {} }),
      });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should prompt confirmation when closing with unsaved changes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sharedConfig: {} }),
      });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '{ "changed": true }' } });

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(mockConfirm).toHaveBeenCalledWith('You have unsaved changes. Are you sure you want to close?');
    });

    it('should not close if user cancels confirmation', async () => {
      mockConfirm.mockReturnValue(false);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sharedConfig: {} }),
      });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '{ "changed": true }' } });

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });

    it('should close on Escape key press', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sharedConfig: {} }),
      });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should close on backdrop click', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sharedConfig: {} }),
      });

      render(<PluginConfigModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      // Click the backdrop (first div with bg-black class)
      const backdrop = document.querySelector('.bg-black\\/60');
      if (backdrop) {
        fireEvent.click(backdrop);
      }

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });
});
