import React, { useEffect, useRef, useState } from 'react';
import { Radio, Trash2 } from 'lucide-react';

interface Props {
  jobId: string | null;
  streamEvents: (
    jobId: string,
    onEvent: (data: string) => void,
    signal?: AbortSignal,
  ) => void;
}

export const EventsStream: React.FC<Props> = ({ jobId, streamEvents }) => {
  const [events, setEvents] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jobId) {
      setConnected(false);
      return;
    }

    setEvents([]);
    setConnected(true);
    const controller = new AbortController();

    streamEvents(
      jobId,
      (data) => {
        setEvents((prev) => [...prev.slice(-200), `[${new Date().toLocaleTimeString()}] ${data}`]);
      },
      controller.signal,
    );

    return () => {
      controller.abort();
      setConnected(false);
    };
  }, [jobId, streamEvents]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">Events</h3>
          {connected && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <Radio size={10} className="animate-pulse" /> Live
            </span>
          )}
        </div>
        {events.length > 0 && (
          <button
            onClick={() => setEvents([])}
            className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Clear events"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-zinc-900/50 rounded border border-zinc-700/50 p-2">
        {!jobId && (
          <div className="text-xs text-zinc-500 text-center py-4">
            Select a job to stream events
          </div>
        )}
        {jobId && events.length === 0 && (
          <div className="text-xs text-zinc-500 text-center py-4">
            Waiting for events...
          </div>
        )}
        {events.map((event, i) => (
          <div key={i} className="text-[11px] font-mono text-zinc-400 leading-relaxed break-all">
            {event}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
};
