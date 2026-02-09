/**
 * Community Hub API Client
 *
 * Uses @naap/plugin-sdk for backend URL resolution.
 * User identification is provided by callers via setCurrentUser(),
 * which should be called from React components using the useAuth/useUser SDK hooks.
 */

import {
  getPluginBackendUrl,
  getCsrfToken,
  generateCorrelationId,
} from '@naap/plugin-sdk';

// Get Community API URL using SDK's unified resolution
const API_BASE = getPluginBackendUrl('community', {
  apiPath: '/api/v1/community',
});

// Module-level user state, set by React components via setCurrentUser()
let _currentUser: { userId: string; displayName: string } | null = null;

/**
 * Set the current user from a React component (call from useEffect with useAuth/useUser hooks).
 */
export function setCurrentUser(user: { userId: string; displayName: string } | null) {
  _currentUser = user;
}

/**
 * Get the current user. Returns null if not set.
 */
export function getCurrentUser(): { userId: string; displayName: string } | null {
  return _currentUser;
}

export function isUserLoggedIn(): boolean {
  return getCurrentUser() !== null;
}

// Auth token storage key (must match shell's STORAGE_KEYS.AUTH_TOKEN)
const AUTH_TOKEN_KEY = 'naap_auth_token';

// Get auth token from available sources
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  // 1. Try shell context (iframe mode)
  const shellContext = (window as any).__SHELL_CONTEXT__;
  if (shellContext?.authToken) return shellContext.authToken;
  // 2. Read from localStorage (UMD mode)
  if (typeof localStorage !== 'undefined') return localStorage.getItem(AUTH_TOKEN_KEY);
  return null;
}

/**
 * Get auth headers with proper token retrieval
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add CSRF token
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  // Add correlation ID for tracing
  headers['X-Correlation-ID'] = generateCorrelationId();
  headers['X-Plugin-Name'] = 'community';

  return headers;
}

// Types
export interface User {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  reputation: number;
  level: number;
  levelName?: string;
  bio?: string | null;
  postCount?: number;
  commentCount?: number;
  badges?: Badge[];
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  color: string;
  description?: string;
  usageCount?: number;
}

export interface Post {
  id: string;
  title: string;
  content: string;
  postType: 'QUESTION' | 'DISCUSSION' | 'ANNOUNCEMENT' | 'SHOWCASE';
  category: string;
  status: string;
  upvotes: number;
  viewCount: number;
  commentCount: number;
  isSolved: boolean;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  author: User;
  tags: Tag[];
  comments?: Comment[];
}

export interface Comment {
  id: string;
  postId: string;
  content: string;
  upvotes: number;
  isAccepted: boolean;
  createdAt: string;
  updatedAt: string;
  author: User;
}

export interface Badge {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  criteria: string;
  earnedAt?: string;
}

export interface LeaderboardEntry extends User {
  rank: number;
}

// API Functions

export async function fetchPosts(params?: {
  category?: string;
  postType?: string;
  solved?: boolean;
  search?: string;
  tag?: string;
  sort?: 'recent' | 'popular' | 'unanswered';
  limit?: number;
  offset?: number;
}): Promise<{ posts: Post[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set('category', params.category);
  if (params?.postType) searchParams.set('postType', params.postType);
  if (params?.solved !== undefined) searchParams.set('solved', String(params.solved));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.tag) searchParams.set('tag', params.tag);
  if (params?.sort) searchParams.set('sort', params.sort);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const res = await fetch(`${API_BASE}/posts?${searchParams}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch posts');
  const data = await res.json();
  return { posts: Array.isArray(data?.posts) ? data.posts : [], total: data?.total ?? 0 };
}

export async function fetchPost(id: string): Promise<Post> {
  const res = await fetch(`${API_BASE}/posts/${id}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch post');
  return res.json();
}

export async function createPost(data: {
  title: string;
  content: string;
  postType?: string;
  category?: string;
  tags?: string[];
}): Promise<Post> {
  const user = getCurrentUser();
  if (!user) throw new Error('Please log in to create a post');

  const res = await fetch(`${API_BASE}/posts`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ ...data, userId: user.userId, displayName: user.displayName }),
  });
  if (!res.ok) throw new Error('Failed to create post');
  return res.json();
}

export async function updatePost(id: string, data: {
  title?: string;
  content?: string;
  category?: string;
}): Promise<Post> {
  const user = getCurrentUser();
  if (!user) throw new Error('Please log in to update');

  const res = await fetch(`${API_BASE}/posts/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ ...data, userId: user.userId }),
  });
  if (!res.ok) throw new Error('Failed to update post');
  return res.json();
}

export async function deletePost(id: string): Promise<void> {
  const user = getCurrentUser();
  if (!user) throw new Error('Please log in to delete');

  const res = await fetch(`${API_BASE}/posts/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    body: JSON.stringify({ userId: user.userId }),
  });
  if (!res.ok) throw new Error('Failed to delete post');
}

export async function votePost(id: string): Promise<{ upvotes: number; voted: boolean }> {
  const user = getCurrentUser();
  if (!user) throw new Error('Please log in to vote');

  const res = await fetch(`${API_BASE}/posts/${id}/vote`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ userId: user.userId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to vote');
  }
  return res.json();
}

export async function removeVote(id: string): Promise<{ upvotes: number; voted: boolean }> {
  const user = getCurrentUser();
  if (!user) throw new Error('Please log in');

  const res = await fetch(`${API_BASE}/posts/${id}/vote`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    body: JSON.stringify({ userId: user.userId }),
  });
  if (!res.ok) throw new Error('Failed to remove vote');
  return res.json();
}

export async function checkVoted(postId: string): Promise<boolean> {
  const user = getCurrentUser();
  if (!user) return false;

  const res = await fetch(`${API_BASE}/posts/${postId}/vote?userId=${user.userId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.voted;
}

export async function fetchComments(postId: string): Promise<Comment[]> {
  const res = await fetch(`${API_BASE}/posts/${postId}/comments`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch comments');
  return res.json();
}

export async function createComment(postId: string, content: string): Promise<Comment> {
  const user = getCurrentUser();
  if (!user) throw new Error('Please log in to comment');

  const res = await fetch(`${API_BASE}/posts/${postId}/comments`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ userId: user.userId, displayName: user.displayName, content }),
  });
  if (!res.ok) throw new Error('Failed to create comment');
  return res.json();
}

export async function voteComment(id: string): Promise<{ upvotes: number; voted: boolean }> {
  const user = getCurrentUser();
  if (!user) throw new Error('Please log in to vote');

  const res = await fetch(`${API_BASE}/comments/${id}/vote`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ userId: user.userId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to vote');
  }
  return res.json();
}

export async function acceptAnswer(commentId: string): Promise<Comment> {
  const user = getCurrentUser();
  if (!user) throw new Error('Please log in');

  const res = await fetch(`${API_BASE}/comments/${commentId}/accept`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ userId: user.userId }),
  });
  if (!res.ok) throw new Error('Failed to accept answer');
  return res.json();
}

export async function fetchLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  const res = await fetch(`${API_BASE}/leaderboard?limit=${limit}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch leaderboard');
  const data = await res.json();
  return Array.isArray(data) ? data : (Array.isArray(data?.entries) ? data.entries : []);
}

export async function fetchTags(limit = 20): Promise<Tag[]> {
  const res = await fetch(`${API_BASE}/tags?limit=${limit}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch tags');
  const data = await res.json();
  return Array.isArray(data) ? data : (Array.isArray(data?.tags) ? data.tags : []);
}

export async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`${API_BASE}/users/${id}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch user');
  return res.json();
}

export async function fetchStats(): Promise<{
  totalPosts: number;
  totalComments: number;
  totalUsers: number;
  solvedQuestions: number;
}> {
  const res = await fetch(`${API_BASE}/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

export async function searchPosts(query: string, params?: {
  category?: string;
  solved?: boolean;
  tag?: string;
}): Promise<{ posts: Post[]; total: number; query: string }> {
  const searchParams = new URLSearchParams();
  searchParams.set('q', query);
  if (params?.category) searchParams.set('category', params.category);
  if (params?.solved !== undefined) searchParams.set('solved', String(params.solved));
  if (params?.tag) searchParams.set('tag', params.tag);

  const res = await fetch(`${API_BASE}/search?${searchParams}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to search');
  return res.json();
}
