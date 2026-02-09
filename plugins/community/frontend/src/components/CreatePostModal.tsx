import React, { useState } from 'react';
import { X, Loader2, HelpCircle, MessageSquare, Sparkles } from 'lucide-react';
import { createPost } from '../api/client';

interface CreatePostModalProps {
  onClose: () => void;
  onCreated: () => void;
}

const POST_TYPES = [
  { value: 'QUESTION', label: 'Question', icon: <HelpCircle size={16} />, description: 'Get help from the community' },
  { value: 'DISCUSSION', label: 'Discussion', icon: <MessageSquare size={16} />, description: 'Start a conversation' },
  { value: 'SHOWCASE', label: 'Showcase', icon: <Sparkles size={16} />, description: 'Share what you built' },
];

const CATEGORIES = [
  { value: 'GENERAL', label: 'General' },
  { value: 'ORCHESTRATORS', label: 'Orchestrators' },
  { value: 'TRANSCODERS', label: 'Transcoders' },
  { value: 'AI_PIPELINES', label: 'AI Pipelines' },
  { value: 'GOVERNANCE', label: 'Governance' },
  { value: 'TROUBLESHOOTING', label: 'Troubleshooting' },
];

export const CreatePostModal: React.FC<CreatePostModalProps> = ({ onClose, onCreated }) => {
  const [postType, setPostType] = useState('QUESTION');
  const [category, setCategory] = useState('GENERAL');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!content.trim()) {
      setError('Content is required');
      return;
    }

    setSubmitting(true);
    try {
      await createPost({
        title: title.trim(),
        content: content.trim(),
        postType,
        category,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg-primary border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-bold text-text-primary">Create New Post</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} className="text-text-secondary" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Post Type */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-3">
              What type of post is this?
            </label>
            <div className="grid grid-cols-3 gap-3">
              {POST_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setPostType(type.value)}
                  className={`p-4 rounded-xl border text-left transition-all ${
                    postType === type.value
                      ? 'border-accent-blue bg-accent-blue/10'
                      : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={postType === type.value ? 'text-accent-blue' : 'text-text-secondary'}>
                      {type.icon}
                    </span>
                    <span className={`font-medium ${postType === type.value ? 'text-accent-blue' : 'text-text-primary'}`}>
                      {type.label}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">{type.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-accent-blue appearance-none cursor-pointer"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                postType === 'QUESTION'
                  ? 'e.g., How do I configure multi-GPU transcoding?'
                  : 'Give your post a clear title'
              }
              className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-accent-blue"
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Content
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              placeholder={`Describe your ${postType.toLowerCase()} in detail...

You can use Markdown:
- **bold** and *italic* text
- \`inline code\` and code blocks with \`\`\`
- Lists and headers

Be specific and include relevant details like:
- Your setup/configuration
- Error messages (if any)
- What you've already tried`}
              className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-accent-blue resize-none font-mono"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Tags (comma separated)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g., gpu, orchestrator, troubleshooting"
              className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-accent-blue"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-6 py-2.5 bg-accent-emerald text-white rounded-xl font-medium hover:bg-accent-emerald/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Posting...
                </>
              ) : (
                'Post'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreatePostModal;
