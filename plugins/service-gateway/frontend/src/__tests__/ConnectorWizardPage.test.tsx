import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MockShellProvider } from '@naap/plugin-sdk/testing';
import { MemoryRouter } from 'react-router-dom';
import { ConnectorWizardPage } from '../pages/ConnectorWizardPage';

function renderWizard() {
  return render(
    <MockShellProvider>
      <MemoryRouter>
        <ConnectorWizardPage />
      </MemoryRouter>
    </MockShellProvider>
  );
}

describe('ConnectorWizardPage', () => {
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: 'tpl-openai',
              name: 'OpenAI',
              description: 'OpenAI GPT API',
              icon: '🤖',
              category: 'ai',
              slug: 'openai',
              authType: 'bearer',
              endpointCount: 2,
              upstreamBaseUrl: 'https://api.openai.com',
              secretRefs: ['token'],
              endpoints: [
                { name: 'Chat', method: 'POST', path: '/chat', upstreamPath: '/v1/chat/completions', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
  });

  it('renders step 1 (Template) as default', async () => {
    renderWizard();
    expect(screen.getByText('Choose a Template')).toBeInTheDocument();
    expect(screen.getByText('Skip — Create from Scratch')).toBeInTheDocument();
  });

  it('loads and displays templates', async () => {
    renderWizard();
    await waitFor(() => {
      expect(screen.getByText('OpenAI')).toBeInTheDocument();
    });
  });

  it('navigates to step 2 (Connect) on "Skip"', async () => {
    renderWizard();
    fireEvent.click(screen.getByText('Skip — Create from Scratch'));
    expect(screen.getByText('Connect to Upstream Service')).toBeInTheDocument();
  });

  it('shows required fields in Connect step', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Skip — Create from Scratch'));

    expect(screen.getByPlaceholderText('My API')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('my-api')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://api.example.com')).toBeInTheDocument();
  });

  it('validates URL input', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Skip — Create from Scratch'));

    const urlInput = screen.getByPlaceholderText('https://api.example.com');
    fireEvent.change(urlInput, { target: { value: 'not-a-url' } });
    expect(screen.getByText('✗')).toBeInTheDocument();

    fireEvent.change(urlInput, { target: { value: 'https://api.example.com' } });
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('shows placeholder warning for YOUR_ URLs', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Skip — Create from Scratch'));

    const urlInput = screen.getByPlaceholderText('https://api.example.com');
    fireEvent.change(urlInput, { target: { value: 'https://YOUR_PROJECT.supabase.co' } });
    expect(screen.getByText('Placeholder')).toBeInTheDocument();
  });

  it('disables Next when required fields are empty', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Skip — Create from Scratch'));

    const nextBtn = screen.getByText('Next →');
    expect(nextBtn).toBeDisabled();
  });

  it('enables Next when required fields are filled', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Skip — Create from Scratch'));

    fireEvent.change(screen.getByPlaceholderText('My API'), { target: { value: 'Test API' } });
    fireEvent.change(screen.getByPlaceholderText('my-api'), { target: { value: 'test-api' } });
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com'), { target: { value: 'https://api.test.com' } });

    const nextBtn = screen.getByText('Next →');
    expect(nextBtn).not.toBeDisabled();
  });

  it('selects a template and applies it to wizard', async () => {
    renderWizard();

    await waitFor(() => {
      expect(screen.getByText('OpenAI')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('OpenAI'));
    fireEvent.click(screen.getByText('Next →'));

    await waitFor(() => {
      expect(screen.getByText('Connect to Upstream Service')).toBeInTheDocument();
    });
  });

  it('shows visibility options (Private, Team, Public)', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Skip — Create from Scratch'));

    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
  });
});
