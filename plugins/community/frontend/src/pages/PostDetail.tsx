import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ThumbsUp, Clock, CheckCircle, MessageSquare, Send, Loader2, Eye } from 'lucide-react';
import { Card, Badge } from '@naap/ui';
import {
  fetchPost,
  votePost,
  removeVote,
  checkVoted,
  createComment,
  voteComment,
  acceptAnswer,
  isUserLoggedIn,
  getCurrentUser,
  type Post,
} from '../api/client';

const LEVEL_COLORS: Record<number, string> = {
  1: '#6b7280',
  2: '#3b82f6',
  3: '#06b6d4',
  4: '#10b981',
  5: '#f59e0b',
  6: '#8b5cf6',
};

const LEVEL_NAMES: Record<number, string> = {
  1: 'Newcomer',
  2: 'Contributor',
  3: 'Regular',
  4: 'Trusted',
  5: 'Expert',
  6: 'Legend',
};

// Simple markdown to HTML conversion
function renderMarkdown(content: string): string {
  let html = content
    // Code blocks
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="code-block"><code class="language-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  // Wrap in paragraph
  html = '<p>' + html + '</p>';

  // Fix list items
  html = html.replace(/<\/li><br\/><li>/g, '</li><li>');
  html = html.replace(/<li>/g, '<ul><li>').replace(/<\/li>(?!<li>)/g, '</li></ul>');
  html = html.replace(/<\/ul><ul>/g, '');

  return html;
}

export const PostDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [voted, setVoted] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [votedComments, setVotedComments] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchPost(id);
        setPost(data);

        if (isUserLoggedIn()) {
          const hasVoted = await checkVoted(id);
          setVoted(hasVoted);
        }
      } catch (err) {
        console.error('Failed to load post:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  const handleVote = async () => {
    if (!post) return;

    if (!isUserLoggedIn()) {
      alert('Please log in to vote');
      return;
    }

    try {
      if (voted) {
        const result = await removeVote(post.id);
        setPost({ ...post, upvotes: result.upvotes });
        setVoted(false);
      } else {
        const result = await votePost(post.id);
        setPost({ ...post, upvotes: result.upvotes });
        setVoted(true);
      }
    } catch (err) {
      console.error('Vote failed:', err);
      alert('Vote failed: ' + (err as Error).message);
    }
  };

  const handleVoteComment = async (commentId: string) => {
    if (!post) return;

    if (!isUserLoggedIn()) {
      alert('Please log in to vote');
      return;
    }

    try {
      const result = await voteComment(commentId);
      setPost({
        ...post,
        comments: post.comments?.map((c) =>
          c.id === commentId ? { ...c, upvotes: result.upvotes } : c
        ),
      });
      setVotedComments((prev) => new Set(prev).add(commentId));
    } catch (err) {
      console.error('Vote failed:', err);
      alert('Vote failed: ' + (err as Error).message);
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!post || !commentText.trim()) return;

    if (!isUserLoggedIn()) {
      alert('Please log in to comment');
      return;
    }

    setSubmitting(true);
    try {
      const newComment = await createComment(post.id, commentText);
      setPost({
        ...post,
        comments: [...(post.comments || []), newComment],
        commentCount: post.commentCount + 1,
      });
      setCommentText('');
    } catch (err) {
      console.error('Failed to submit comment:', err);
      alert('Failed to submit comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptAnswer = async (commentId: string) => {
    if (!post) return;

    if (!isUserLoggedIn()) {
      alert('Please log in first');
      return;
    }

    try {
      await acceptAnswer(commentId);
      setPost({
        ...post,
        isSolved: true,
        comments: post.comments?.map((c) => ({
          ...c,
          isAccepted: c.id === commentId,
        })),
      });
    } catch (err) {
      console.error('Failed to accept answer:', err);
      alert('Failed to accept answer: ' + (err as Error).message);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const currentUser = getCurrentUser();
  const isAuthor = post && currentUser && currentUser.userId === post.author.userId;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent-blue" size={32} />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-bold text-text-primary mb-2">Post not found</h2>
        <button onClick={() => navigate('/')} className="text-accent-blue hover:underline">
          Back to forum
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={18} /> Back to Forum
      </button>

      {/* Post */}
      <Card className="overflow-hidden">
        <div className="flex gap-6">
          {/* Vote column */}
          <div className="flex flex-col items-center gap-2 pt-2">
            <button
              onClick={handleVote}
              className={`p-3 rounded-xl transition-all ${
                voted
                  ? 'bg-accent-emerald/20 text-accent-emerald'
                  : 'hover:bg-accent-emerald/10 text-text-secondary hover:text-accent-emerald'
              }`}
            >
              <ThumbsUp size={24} />
            </button>
            <span className="text-2xl font-bold font-mono text-text-primary">{post.upvotes}</span>
          </div>

          {/* Content */}
          <div className="flex-1">
            {/* Meta */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              {post.isPinned && <Badge variant="amber">Pinned</Badge>}
              <Badge variant={post.postType === 'QUESTION' ? 'blue' : 'secondary'}>
                {post.postType.charAt(0) + post.postType.slice(1).toLowerCase()}
              </Badge>
              {post.isSolved && (
                <Badge variant="emerald">
                  <span className="flex items-center gap-1">
                    <CheckCircle size={12} /> Solved
                  </span>
                </Badge>
              )}
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold text-text-primary mb-4">{post.title}</h1>

            {/* Author info */}
            <div className="flex items-center gap-3 mb-6 pb-6 border-b border-white/10">
              <div className="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center">
                <span className="text-lg">@</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="font-medium"
                    style={{ color: LEVEL_COLORS[post.author.level] }}
                  >
                    {post.author.displayName || post.author.userId?.slice(0, 10)}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-medium"
                    style={{
                      backgroundColor: `${LEVEL_COLORS[post.author.level]}20`,
                      color: LEVEL_COLORS[post.author.level],
                    }}
                  >
                    Level {post.author.level} - {LEVEL_NAMES[post.author.level]}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-text-secondary mt-1">
                  <span className="flex items-center gap-1">
                    <Clock size={12} /> {formatDate(post.createdAt)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Eye size={12} /> {post.viewCount} views
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare size={12} /> {post.commentCount} answers
                  </span>
                </div>
              </div>
            </div>

            {/* Content */}
            <div
              className="prose prose-invert max-w-none mb-6"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
            />

            {/* Tags */}
            <div className="flex gap-2 flex-wrap">
              {post.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="px-3 py-1 rounded-lg text-sm"
                  style={{
                    backgroundColor: `${tag.color}20`,
                    color: tag.color,
                  }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Answers */}
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <MessageSquare size={20} /> {post.comments?.length || 0} Answers
        </h2>

        <div className="space-y-4">
          {post.comments?.map((comment) => (
            <Card
              key={comment.id}
              className={`${
                comment.isAccepted ? 'border-accent-emerald/50 bg-accent-emerald/5' : ''
              }`}
            >
              <div className="flex gap-4">
                {/* Vote column */}
                <div className="flex flex-col items-center gap-1">
                  <button
                    onClick={() => handleVoteComment(comment.id)}
                    disabled={votedComments.has(comment.id)}
                    className={`p-2 rounded-lg transition-all ${
                      votedComments.has(comment.id)
                        ? 'bg-accent-emerald/20 text-accent-emerald'
                        : 'hover:bg-accent-emerald/10 text-text-secondary hover:text-accent-emerald'
                    }`}
                  >
                    <ThumbsUp size={16} />
                  </button>
                  <span className="font-mono font-bold text-sm text-text-primary">
                    {comment.upvotes}
                  </span>
                  {comment.isAccepted && (
                    <CheckCircle className="text-accent-emerald" size={20} />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1">
                  {comment.isAccepted && (
                    <div className="flex items-center gap-2 text-accent-emerald text-sm font-medium mb-3">
                      <CheckCircle size={14} /> Accepted Answer
                    </div>
                  )}

                  <div
                    className="prose prose-invert max-w-none prose-sm mb-4"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(comment.content) }}
                  />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className="font-medium text-sm"
                        style={{ color: LEVEL_COLORS[comment.author.level] }}
                      >
                        {comment.author.displayName || comment.author.userId?.slice(0, 10)}
                      </span>
                      <span className="text-xs text-text-secondary">
                        {formatDate(comment.createdAt)}
                      </span>
                    </div>

                    {isAuthor && post.postType === 'QUESTION' && !comment.isAccepted && !post.isSolved && (
                      <button
                        onClick={() => handleAcceptAnswer(comment.id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-accent-emerald/20 text-accent-emerald rounded-lg text-sm font-medium hover:bg-accent-emerald/30 transition-all"
                      >
                        <CheckCircle size={14} /> Accept Answer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}

          {(!post.comments || post.comments.length === 0) && (
            <Card className="text-center py-8">
              <MessageSquare size={32} className="mx-auto mb-2 text-text-secondary opacity-30" />
              <p className="text-text-secondary">No answers yet. Be the first to help!</p>
            </Card>
          )}
        </div>
      </div>

      {/* Add Answer */}
      <Card>
        <h3 className="font-bold text-text-primary mb-4">Your Answer</h3>
        <form onSubmit={handleSubmitComment}>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Write your answer... You can use Markdown for formatting and code blocks."
            className="w-full h-40 bg-bg-secondary border border-white/10 rounded-xl p-4 text-sm resize-none focus:outline-none focus:border-accent-blue"
          />
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-text-secondary">
              Supports Markdown: **bold**, *italic*, `code`, ```code blocks```
            </p>
            <button
              type="submit"
              disabled={submitting || !commentText.trim()}
              className="flex items-center gap-2 px-6 py-2.5 bg-accent-blue text-white rounded-xl font-medium hover:bg-accent-blue/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
              Post Answer
            </button>
          </div>
        </form>
      </Card>

      {/* Inline styles for code blocks */}
      <style>{`
        .code-block {
          background: #1a1a2e;
          border-radius: 8px;
          padding: 16px;
          overflow-x: auto;
          margin: 16px 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          line-height: 1.5;
        }
        .inline-code {
          background: #1a1a2e;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.9em;
        }
        .prose h1, .prose h2, .prose h3 {
          color: #fff;
          margin-top: 24px;
          margin-bottom: 12px;
        }
        .prose h1 { font-size: 1.5em; }
        .prose h2 { font-size: 1.25em; }
        .prose h3 { font-size: 1.1em; }
        .prose ul {
          list-style-type: disc;
          padding-left: 24px;
          margin: 12px 0;
        }
        .prose li {
          margin: 4px 0;
        }
        .prose p {
          margin: 12px 0;
        }
        .prose strong {
          color: #fff;
        }
      `}</style>
    </div>
  );
};

export default PostDetailPage;
