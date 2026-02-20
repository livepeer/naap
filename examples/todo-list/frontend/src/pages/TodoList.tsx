/**
 * Todo List Page
 * 
 * Demonstrates CRUD operations with a backend API using SDK hooks:
 * - useApiClient for API calls with auto auth/CSRF
 * - useAuthService for authentication
 * - useNotify for notifications
 * - useNavigate for navigation
 */

import React, { useState, useEffect } from 'react';
import { CheckSquare, Plus, Trash2, Check, Circle, Loader2 } from 'lucide-react';
import { useAuthService, useNotify, useNavigate, useApiClient } from '@naap/plugin-sdk';

interface Todo {
  id: string;
  title: string;
  completed: boolean;
  userId: string;
  createdAt: string;
}

// Backend URL - useApiClient will auto-resolve if configured
const API_URL = 'http://localhost:4021';

export const TodoList: React.FC = () => {
  // Use SDK hooks instead of direct context access
  const auth = useAuthService();
  const notify = useNotify();
  const navigate = useNavigate();
  const api = useApiClient({ pluginName: 'todoList', baseUrl: API_URL });

  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodo, setNewTodo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Get user and auth state from auth service
  const user = auth.getUser();
  const isConnected = auth.isAuthenticated();

  // Fetch todos using API client (auto includes auth headers)
  const fetchTodos = async () => {
    if (!isConnected) {
      setLoading(false);
      return;
    }

    try {
      const response = await api.get<{ todos: Todo[] }>('/api/v1/todos');
      setTodos(response.data.todos || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load todos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTodos();
  }, [isConnected]);

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodo.trim()) return;

    try {
      const response = await api.post<{ todo: Todo }>('/api/v1/todos', { title: newTodo });
      setTodos([response.data.todo, ...todos]);
      setNewTodo('');
      notify.success('Todo added!');
    } catch (err) {
      notify.error('Failed to add todo');
    }
  };

  const toggleTodo = async (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;

    try {
      await api.patch(`/api/v1/todos/${id}`, { completed: !todo.completed });
      setTodos(todos.map(t => 
        t.id === id ? { ...t, completed: !t.completed } : t
      ));
    } catch (err) {
      notify.error('Failed to update todo');
    }
  };

  const deleteTodo = async (id: string) => {
    try {
      await api.delete(`/api/v1/todos/${id}`);
      setTodos(todos.filter(t => t.id !== id));
      notify.info('Todo deleted');
    } catch (err) {
      notify.error('Failed to delete todo');
    }
  };

  if (!isConnected) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center">
        <CheckSquare className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
        <h1 className="text-2xl font-bold text-text-primary mb-2">Todo List</h1>
        <p className="text-text-secondary mb-6">Please log in to manage your todos.</p>
        <button
          onClick={() => navigate('/login')}
          className="px-6 py-3 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-xl transition-colors"
        >
          Go to Login
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-xl bg-accent-blue/20 flex items-center justify-center">
          <CheckSquare className="w-6 h-6 text-accent-blue" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Todo List</h1>
          <p className="text-text-secondary">Manage your tasks</p>
        </div>
      </div>

      {/* Add Todo Form */}
      <form onSubmit={addTodo} className="flex gap-3 mb-6">
        <input
          type="text"
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          placeholder="What needs to be done?"
          className="flex-1 px-4 py-3 bg-secondary border border-white/10 rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-blue"
        />
        <button
          type="submit"
          className="px-4 py-3 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-xl transition-colors flex items-center gap-2"
        >
          <Plus size={20} />
          Add
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent-blue" />
        </div>
      ) : todos.length === 0 ? (
        <div className="text-center py-12 text-text-secondary">
          <Circle className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No todos yet. Add one above!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {todos.map((todo) => (
            <div
              key={todo.id}
              className="flex items-center gap-3 p-4 bg-secondary border border-white/10 rounded-xl group"
            >
              <button
                onClick={() => toggleTodo(todo.id)}
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                  todo.completed
                    ? 'bg-accent-emerald border-accent-emerald'
                    : 'border-white/20 hover:border-white/40'
                }`}
              >
                {todo.completed && <Check size={14} className="text-white" />}
              </button>
              <span
                className={`flex-1 ${
                  todo.completed ? 'line-through text-text-tertiary' : 'text-text-primary'
                }`}
              >
                {todo.title}
              </span>
              <button
                onClick={() => deleteTodo(todo.id)}
                className="p-2 text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Stats */}
      {todos.length > 0 && (
        <div className="mt-6 text-sm text-text-tertiary text-center">
          {todos.filter(t => t.completed).length} of {todos.length} completed
        </div>
      )}
    </div>
  );
};
