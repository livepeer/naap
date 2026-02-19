/**
 * Todo List Backend
 * 
 * A simple Express server demonstrating plugin backend patterns:
 * - CRUD API for todos
 * - Auth token validation
 * - User-scoped data
 */

import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 4021;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage (in production, use a database)
interface Todo {
  id: string;
  title: string;
  completed: boolean;
  userId: string;
  createdAt: string;
}

const todos: Map<string, Todo> = new Map();

// Simple auth middleware - validates token with shell's base-svc
async function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    // Validate token with shell's base-svc
    const baseUrl = process.env.BASE_SVC_URL || 'http://localhost:4000';
    const authRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!authRes.ok) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const data = await authRes.json();
    (req as any).user = data.user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: 'Auth service unavailable' });
  }
}

// Health check
app.get('/healthz', (_req, res) => {
  res.json({ status: 'healthy', service: 'todo-list' });
});

// List todos for user
app.get('/api/v1/todos', authenticate, (req, res) => {
  const userId = (req as any).user?.id;
  
  const userTodos = Array.from(todos.values())
    .filter(todo => todo.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  res.json({ todos: userTodos });
});

// Create todo
app.post('/api/v1/todos', authenticate, (req, res) => {
  const userId = (req as any).user?.id;
  const { title } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const todo: Todo = {
    id: uuidv4(),
    title,
    completed: false,
    userId,
    createdAt: new Date().toISOString(),
  };

  todos.set(todo.id, todo);
  res.status(201).json({ todo });
});

// Update todo
app.patch('/api/v1/todos/:id', authenticate, (req, res) => {
  const userId = (req as any).user?.id;
  const { id } = req.params;
  const { title, completed } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Missing id parameter' });
  }

  const todo = todos.get(id);

  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  // Check ownership (admins can update any, users only their own)
  const userRoles = (req as any).user?.roles || [];
  const isAdmin = userRoles.includes('todo-list:admin') || userRoles.includes('system:admin');
  
  if (todo.userId !== userId && !isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  if (title !== undefined) todo.title = title;
  if (completed !== undefined) todo.completed = completed;

  todos.set(id, todo);
  res.json({ todo });
});

// Delete todo
app.delete('/api/v1/todos/:id', authenticate, (req, res) => {
  const userId = (req as any).user?.id;
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Missing id parameter' });
  }

  const todo = todos.get(id);

  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  // Check ownership (admins can delete any, users only their own)
  const userRoles = (req as any).user?.roles || [];
  const isAdmin = userRoles.includes('todo-list:admin') || userRoles.includes('system:admin');
  
  if (todo.userId !== userId && !isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  todos.delete(id);
  res.status(204).send();
});

// Start server
app.listen(PORT, () => {
  console.log(`Todo List backend running on port ${PORT}`);
});
