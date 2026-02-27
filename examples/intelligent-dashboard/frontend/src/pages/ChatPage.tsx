import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { BrainCircuit } from 'lucide-react';
import { ChatInput } from '../components/ChatInput';
import { MessageBubble } from '../components/MessageBubble';
import { ProgressSteps } from '../components/ProgressSteps';
import { DynamicRenderer } from '../components/DynamicRenderer';
import { AgentOrchestrator } from '../agent/orchestrator';
import { createAnalyticSkill } from '../skills/analyticSkill';
import { createUXSkill } from '../skills/uxSkill';
import { useGeminiApi } from '../hooks/useGeminiApi';
import { useLeaderboardApi } from '../hooks/useLeaderboardApi';
import type { AgentStep, ConversationEntry, RenderSpec, AnalyticsResult } from '../types';

const EXAMPLE_PROMPTS = [
  'Top orchestrators for FLUX image generation',
  'Fastest text-to-image providers',
  'Compare success rates for image-to-video',
];

export const ChatPage: React.FC = () => {
  const geminiApi = useGeminiApi();
  const leaderboardApi = useLeaderboardApi();

  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [currentStep, setCurrentStep] = useState<AgentStep>('idle');
  const [stepDetail, setStepDetail] = useState('');
  const [latestSpec, setLatestSpec] = useState<RenderSpec | null>(null);
  const [latestData, setLatestData] = useState<AnalyticsResult | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>();

  const orchestrator = useMemo(() => {
    const analyticSkill = createAnalyticSkill(
      geminiApi.generateContent,
      leaderboardApi.fetchStats,
      leaderboardApi.fetchPipelines,
    );
    const uxSkill = createUXSkill(geminiApi.generateContent);
    return new AgentOrchestrator(analyticSkill, uxSkill);
  }, [geminiApi, leaderboardApi]);

  const scrollToBottom = useCallback(() => {
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  useEffect(scrollToBottom, [conversation, currentStep, scrollToBottom]);

  const handleSubmit = useCallback(
    async (question: string) => {
      const userEntry: ConversationEntry = {
        id: crypto.randomUUID(),
        role: 'user',
        text: question,
      };

      setConversation((prev) => [...prev, userEntry]);
      setCurrentStep('analyzing');
      setStepDetail('');
      setLatestSpec(null);
      setLatestData(null);

      await orchestrator.run(question, {
        onStep: (step, detail) => {
          setCurrentStep(step as AgentStep);
          setStepDetail(detail || '');
        },
        onComplete: (renderSpec, data, summary) => {
          setCurrentStep('complete');
          setLatestSpec(renderSpec);
          setLatestData(data);

          const assistantEntry: ConversationEntry = {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: summary,
            renderSpec,
            analyticsData: data,
          };
          setConversation((prev) => [...prev, assistantEntry]);
        },
        onError: (error) => {
          setCurrentStep('error');
          const errEntry: ConversationEntry = {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: error,
            error,
          };
          setConversation((prev) => [...prev, errEntry]);
        },
      });
    },
    [orchestrator],
  );

  const isProcessing = !['idle', 'complete', 'error'].includes(currentStep);
  const showEmptyState = conversation.length === 0 && !isProcessing;

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] text-gray-100">
      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {showEmptyState && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-4 max-w-lg">
              <BrainCircuit className="w-16 h-16 text-purple-400/30 mx-auto" />
              <h1 className="text-2xl font-bold text-gray-200">Intelligent Dashboard</h1>
              <p className="text-sm text-gray-500">
                Ask questions about Livepeer AI orchestrator performance in natural language.
                The AI agent will analyze your question, fetch real-time data, and create
                the best visualization for your answer.
              </p>
            </div>
          </div>
        )}

        {conversation.map((entry) => (
          <React.Fragment key={entry.id}>
            <MessageBubble entry={entry} />
            {entry.renderSpec && entry.analyticsData && (
              <div className="ml-11">
                <DynamicRenderer spec={entry.renderSpec} data={entry.analyticsData} />
              </div>
            )}
          </React.Fragment>
        ))}

        {isProcessing && (
          <div className="ml-11">
            <ProgressSteps currentStep={currentStep} detail={stepDetail} />
          </div>
        )}

        {/* Live dashboard for latest result (shown while still in chat context) */}
        {!isProcessing && latestSpec && latestData && conversation.length > 0 && !conversation[conversation.length - 1]?.renderSpec && (
          <div className="ml-11">
            <DynamicRenderer spec={latestSpec} data={latestData} />
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-white/10 p-4 bg-black/40">
        <ChatInput
          onSubmit={handleSubmit}
          disabled={isProcessing}
          examplePrompts={showEmptyState ? EXAMPLE_PROMPTS : undefined}
        />
      </div>
    </div>
  );
};
