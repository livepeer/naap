import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Github } from 'lucide-react';
import { Badge } from './Badge';

export interface ReleaseNotesViewerProps {
  isOpen: boolean;
  onClose: () => void;
  version: string;
}

export const ReleaseNotesViewer: React.FC<ReleaseNotesViewerProps> = ({ isOpen, onClose, version }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }} 
            animate={{ scale: 1, opacity: 1 }} 
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-3xl bg-bg-secondary border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
          >
            <div className="p-6 border-b border-white/10 flex items-center justify-between bg-bg-tertiary/20">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-text-primary">
                  <Github size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-outfit">Livepeer Release Notes</h2>
                  <p className="text-xs text-text-secondary">Viewing version <span className="text-accent-blue font-mono">{version}</span></p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-all text-text-secondary hover:text-text-primary">
                <X size={24} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 font-sans custom-scrollbar bg-bg-primary/30">
              <div className="prose prose-invert max-w-none space-y-6">
                <section>
                  <h3 className="text-xl font-bold text-text-primary border-b border-white/5 pb-2">What's New in {version}</h3>
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-text-secondary leading-relaxed">
                      This release introduces significant performance improvements to the AI compute pipelines, specifically targeting LLM inference latency and multi-GPU scheduling.
                    </p>
                    <ul className="space-y-2">
                      <li className="flex gap-3 text-sm text-text-secondary">
                        <Badge variant="blue" className="h-fit">Feature</Badge>
                        <span>Initial support for Flux.1 model in the Text-to-Image pipeline.</span>
                      </li>
                      <li className="flex gap-3 text-sm text-text-secondary">
                        <Badge variant="emerald" className="h-fit">Optimisation</Badge>
                        <span>Reduced cold-start container time for segment-anything-2 by 40%.</span>
                      </li>
                      <li className="flex gap-3 text-sm text-text-secondary">
                        <Badge variant="amber" className="h-fit">Fix</Badge>
                        <span>Resolved a memory leak in the Orchestrator ticketing logic that occurred during high volume rounds.</span>
                      </li>
                    </ul>
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold text-text-secondary uppercase tracking-widest mt-8">Full Changelog</h3>
                  <div className="mt-4 p-4 bg-black/20 rounded-xl border border-white/5 font-mono text-xs text-text-secondary space-y-1">
                    <p>* chore: bump deps (github-actions)</p>
                    <p>* feat: add prometheus metrics for GPU utilization (#1245)</p>
                    <p>* fix: handle eth rpc timeouts more gracefully (#1248)</p>
                    <p>* docs: update gateway configuration guide (#1250)</p>
                  </div>
                </section>
              </div>
            </div>

            <div className="p-6 border-t border-white/10 flex items-center justify-between bg-bg-tertiary/20">
               <div className="text-xs text-text-secondary">
                 Source: <span className="font-mono">livepeer/go-livepeer</span>
               </div>
               <div className="flex gap-3">
                 <button onClick={onClose} className="px-6 py-2 rounded-xl text-xs font-bold text-text-secondary hover:bg-white/5 transition-all">Close</button>
                 <a 
                   href={`https://github.com/livepeer/go-livepeer/releases/tag/${version}`} 
                   target="_blank" 
                   rel="noopener noreferrer"
                   className="flex items-center gap-2 px-6 py-2 bg-accent-blue text-white rounded-xl text-xs font-bold shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 transition-all"
                 >
                    View on GitHub <ExternalLink size={14} />
                 </a>
               </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
