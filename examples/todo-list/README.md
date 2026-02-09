# Todo List Plugin

A full-stack example plugin demonstrating CRUD operations with backend API and role-based access control.

## Features Demonstrated

- **Backend API**: Express.js server with RESTful endpoints
- **Authentication**: Token validation with shell's base-svc
- **RBAC**: Role-based access control (admins vs users)
- **CRUD Operations**: Create, Read, Update, Delete todos
- **Shell Integration**: Notifications, navigation, auth state

## Quick Start

### Start Backend

```bash
cd backend && npm install && npm run dev
```

Backend runs on port 4021.

### Start Frontend

```bash
cd frontend && npm install && npm run dev
```

Frontend runs on port 3021. Register it in the shell:

```javascript
// Add to shell's dev plugins
localStorage.setItem('naap-dev-plugins', JSON.stringify([
  {
    name: 'todoList',
    displayName: 'Todo List',
    remoteUrl: 'http://localhost:3021/production/todoList.js',
    routes: ['/todos', '/todos/*'],
    icon: 'CheckSquare',
    enabled: true
  }
]));
```

## Code Structure

```
todo-list/
├── plugin.json           # Plugin manifest with RBAC config
├── README.md
├── frontend/
│   ├── src/
│   │   ├── App.tsx       # Plugin entry point
│   │   ├── globals.css
│   │   └── pages/
│   │       └── TodoList.tsx  # Main todo UI
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
└── backend/
    ├── src/
    │   └── server.ts     # Express API server
    ├── package.json
    └── tsconfig.json
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /healthz | Health check |
| GET | /api/v1/todos | List user's todos |
| POST | /api/v1/todos | Create a todo |
| PATCH | /api/v1/todos/:id | Update a todo |
| DELETE | /api/v1/todos/:id | Delete a todo |

## Role-Based Access

| Role | Permissions |
|------|-------------|
| `todo-list:admin` | Can manage all todos |
| `todo-list:user` | Can only manage own todos |

## Using Shell Auth

```typescript
// Get auth token from shell
const token = await shellContext?.authToken();

// Make authenticated API call
fetch('/api/v1/todos', {
  headers: { Authorization: `Bearer ${token}` }
});
```

## Backend Auth Middleware

The backend validates tokens with the shell's base-svc:

```typescript
// Validate with shell
const authRes = await fetch(`${BASE_SVC_URL}/api/v1/auth/me`, {
  headers: { Authorization: `Bearer ${token}` }
});

const { user } = await authRes.json();
// user.roles contains ['todo-list:user'] or ['todo-list:admin']
```

## License

MIT
