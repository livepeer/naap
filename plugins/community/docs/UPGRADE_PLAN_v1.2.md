# Community Hub Plugin - Upgrade Plan v1.2

## Executive Summary

Upgrade the Community Hub from a prototype (v1.0) to a fully functional builder community engagement platform (v1.2) designed specifically for Livepeer's technical community.

**Core Philosophy**: Stack Overflow's quality + Reddit's authenticity + GitHub's code-first approach

**Design Principles**:
1. **Speed over features** - Fast answers matter more than fancy UI
2. **Signal over noise** - Voting surfaces the best content
3. **Code-first** - Every post can include runnable code snippets
4. **Searchable archive** - Nothing gets lost, everything is findable
5. **Meritocracy** - Reputation earned through helpful contributions

---

## Target Outcome: v1.2 Feature Set

### Core Features

| Feature | Stack Overflow | Reddit | Our Implementation |
|---------|---------------|--------|-------------------|
| Q&A with accepted answers | ✓ | - | ✓ Simplified |
| Threaded discussions | - | ✓ | ✓ Single-level replies |
| Upvote/downvote | ✓ | ✓ | ✓ Upvote only (positive community) |
| Reputation system | ✓ | ✓ (karma) | ✓ Points + levels |
| Code syntax highlighting | ✓ | - | ✓ Built-in |
| Search + filters | ✓ | ✓ | ✓ Full-text + tags |
| Badges/achievements | ✓ | ✓ | ✓ Milestone badges |

### Unique Value Props

1. **Wallet-linked identity** - Reputation tied to on-chain identity
2. **Livepeer-specific categories** - Orchestrators, Transcoders, AI Pipelines, Governance
3. **Code snippet templates** - Pre-built templates for common Livepeer configs
4. **Solution verification** - Community-verified solutions get special status

---

## Database Schema Design

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     users       │     │     posts       │     │    comments     │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id (PK)         │────<│ authorId (FK)   │     │ id (PK)         │
│ walletAddress   │     │ id (PK)         │────<│ postId (FK)     │
│ displayName     │     │ title           │     │ authorId (FK)   │
│ reputation      │     │ content         │     │ content         │
│ level           │     │ category        │     │ isAccepted      │
│ createdAt       │     │ postType        │     │ upvotes         │
│ avatarUrl       │     │ status          │     │ createdAt       │
│ bio             │     │ upvotes         │     │ updatedAt       │
└─────────────────┘     │ viewCount       │     └─────────────────┘
                        │ isSolved        │
┌─────────────────┐     │ acceptedAnswer  │     ┌─────────────────┐
│     votes       │     │ createdAt       │     │      tags       │
├─────────────────┤     │ updatedAt       │     ├─────────────────┤
│ id (PK)         │     └─────────────────┘     │ id (PK)         │
│ userId (FK)     │                             │ name            │
│ targetType      │     ┌─────────────────┐     │ slug            │
│ targetId        │     │   post_tags     │     │ description     │
│ value (+1)      │     ├─────────────────┤     │ color           │
│ createdAt       │     │ postId (FK)     │     │ usageCount      │
└─────────────────┘     │ tagId (FK)      │     └─────────────────┘
                        └─────────────────┘
┌─────────────────┐
│ reputation_log  │
├─────────────────┤
│ id (PK)         │
│ userId (FK)     │
│ action          │
│ points          │
│ sourceType      │
│ sourceId        │
│ createdAt       │
└─────────────────┘
```

### Post Types
- `question` - Technical Q&A (can have accepted answer)
- `discussion` - Open-ended conversation
- `announcement` - Official updates (admin only)
- `showcase` - Show off your build

### Categories
- `general` - General discussions
- `orchestrators` - Running orchestrator nodes
- `transcoders` - Transcoding setup & optimization
- `ai-pipelines` - AI/ML workloads on Livepeer
- `governance` - Protocol governance & proposals
- `troubleshooting` - Help & support

---

## Phased Implementation Plan

---

## Phase 1: Foundation (v1.1.0)
**Goal**: Replace mock data with real persistence + basic CRUD

**Duration**: 3-4 days
**Deliverable**: Working forum with real data storage

### Backend Tasks

#### 1.1 Database Setup
- [ ] Create Prisma schema with Users, Posts, Tags tables
- [ ] Add community-db to docker-compose.yml (port 5441)
- [ ] Create initial migration
- [ ] Seed with sample data

#### 1.2 API Endpoints
```
GET    /posts              - List posts (paginated, filterable)
GET    /posts/:id          - Get single post with author info
POST   /posts              - Create new post
PUT    /posts/:id          - Update post (author only)
DELETE /posts/:id          - Delete post (author only)
GET    /tags               - List all tags
GET    /users/:id          - Get user profile
PUT    /users/:id          - Update own profile
```

#### 1.3 Authentication Integration
- [ ] Integrate with base-svc JWT validation
- [ ] Add auth middleware for protected routes
- [ ] Auto-create user record on first post

### Frontend Tasks

#### 1.4 Post List Enhancements
- [ ] Connect to real API (replace mock data)
- [ ] Add loading states with skeleton UI
- [ ] Add error handling with retry
- [ ] Implement pagination (infinite scroll)

#### 1.5 Create Post Modal
- [ ] Design simple post creation form
- [ ] Title, content (textarea), category selector, tags input
- [ ] Submit to API with auth token
- [ ] Success/error feedback

#### 1.6 Post Detail Page
- [ ] New route: `/forum/post/:id`
- [ ] Display full post content
- [ ] Show author info with avatar
- [ ] Show creation date and view count

### Definition of Done - Phase 1
- [ ] Can create, read, update, delete posts
- [ ] Posts persist across server restarts
- [ ] Posts linked to authenticated user
- [ ] Basic error handling and loading states
- [ ] All existing UI functionality preserved

---

## Phase 2: Voting & Reputation (v1.1.1)
**Goal**: Implement upvoting and basic reputation system

**Duration**: 2-3 days
**Deliverable**: Working voting with reputation points

### Backend Tasks

#### 2.1 Voting System
- [ ] Add Votes table to schema
- [ ] Create vote endpoints:
  ```
  POST   /posts/:id/vote     - Upvote a post
  DELETE /posts/:id/vote     - Remove vote
  ```
- [ ] Prevent duplicate votes (one per user per target)
- [ ] Update post.upvotes count on vote

#### 2.2 Reputation System
- [ ] Add ReputationLog table
- [ ] Implement point rules:
  | Action | Points |
  |--------|--------|
  | Post created | +5 |
  | Post upvoted | +10 |
  | Your post upvoted | +2 |
  | Answer accepted | +15 |
  | Daily login | +1 |
- [ ] Add reputation field to User
- [ ] Calculate user level based on reputation:
  | Level | Name | Points Required |
  |-------|------|-----------------|
  | 1 | Newcomer | 0 |
  | 2 | Contributor | 50 |
  | 3 | Regular | 200 |
  | 4 | Trusted | 500 |
  | 5 | Expert | 1000 |
  | 6 | Legend | 2500 |

### Frontend Tasks

#### 2.3 Voting UI
- [ ] Make upvote button functional
- [ ] Show if current user has voted
- [ ] Optimistic UI update on vote
- [ ] Animate vote count change

#### 2.4 Reputation Display
- [ ] Show reputation badge next to username
- [ ] Add reputation to user profile
- [ ] Create simple leaderboard component
- [ ] Add leaderboard to sidebar

### Definition of Done - Phase 2
- [ ] Can upvote/remove vote on posts
- [ ] Reputation updates on actions
- [ ] User level displayed with name
- [ ] Leaderboard shows top contributors

---

## Phase 3: Comments & Answers (v1.1.2)
**Goal**: Add threaded replies with accepted answer feature

**Duration**: 3-4 days
**Deliverable**: Full Q&A functionality

### Backend Tasks

#### 3.1 Comments System
- [ ] Add Comments table to schema
- [ ] Create comment endpoints:
  ```
  GET    /posts/:id/comments     - List comments on post
  POST   /posts/:id/comments     - Add comment
  PUT    /comments/:id           - Edit comment
  DELETE /comments/:id           - Delete comment
  ```
- [ ] Add comment count to post response

#### 3.2 Accepted Answer
- [ ] Add isAccepted field to Comments
- [ ] Add acceptedAnswerId to Posts
- [ ] Endpoint: `POST /comments/:id/accept` (post author only)
- [ ] Mark post as solved when answer accepted
- [ ] Award +15 reputation to answer author

#### 3.3 Comment Voting
- [ ] Enable voting on comments (same as posts)
- [ ] Sort comments by votes (best first) or date

### Frontend Tasks

#### 3.4 Comments Section
- [ ] Add comments list below post content
- [ ] Comment composer with markdown preview
- [ ] Reply button and inline reply form
- [ ] Show comment author and time

#### 3.5 Accepted Answer UI
- [ ] Highlight accepted answer with green border
- [ ] "Accept Answer" button for post author
- [ ] "Solved" badge on post cards in list
- [ ] Sort: accepted answer always first

### Definition of Done - Phase 3
- [ ] Can comment on posts
- [ ] Can vote on comments
- [ ] Post author can accept answer
- [ ] Solved posts visually distinguished

---

## Phase 4: Code Collaboration (v1.1.3)
**Goal**: Rich markdown with syntax-highlighted code blocks

**Duration**: 2-3 days
**Deliverable**: Developer-friendly content formatting

### Backend Tasks

#### 4.1 Content Processing
- [ ] Install markdown processor (marked/remark)
- [ ] Sanitize HTML to prevent XSS
- [ ] Store raw markdown, render on read

### Frontend Tasks

#### 4.2 Markdown Editor
- [ ] Install lightweight markdown editor (react-simplemde-editor or custom)
- [ ] Add toolbar: bold, italic, code, link, image
- [ ] Live preview toggle
- [ ] Code block insertion helper

#### 4.3 Syntax Highlighting
- [ ] Install Prism.js or Highlight.js
- [ ] Support languages: JavaScript, TypeScript, Go, Bash, JSON, YAML
- [ ] Add copy button to code blocks
- [ ] Line numbers for long code

#### 4.4 Code Templates
- [ ] Create template selector for common configs:
  - Orchestrator config (JSON)
  - Transcoder setup (Bash)
  - API integration (TypeScript)
  - Docker compose (YAML)
- [ ] Insert template into editor

### Definition of Done - Phase 4
- [ ] Markdown renders correctly in posts/comments
- [ ] Code blocks have syntax highlighting
- [ ] Copy button works on code blocks
- [ ] Templates help users share configs

---

## Phase 5: Search & Gamification (v1.2.0)
**Goal**: Full-text search, badges, and polish

**Duration**: 3-4 days
**Deliverable**: Production-ready v1.2

### Backend Tasks

#### 5.1 Search Implementation
- [ ] Add PostgreSQL full-text search
- [ ] Create search endpoint:
  ```
  GET /search?q=query&category=&tags=&solved=
  ```
- [ ] Index title + content + tags
- [ ] Rank by relevance + recency + votes

#### 5.2 Badge System
- [ ] Create Badges table
- [ ] Define badge types:
  | Badge | Criteria |
  |-------|----------|
  | First Post | Create first post |
  | Helpful | Get 10 upvotes total |
  | Problem Solver | Have 3 accepted answers |
  | Popular | Single post reaches 25 upvotes |
  | Veteran | Member for 30 days |
  | Top Contributor | Reach level 5 |
- [ ] Badge award logic (background job or trigger)
- [ ] Badge endpoint: `GET /users/:id/badges`

### Frontend Tasks

#### 5.3 Search UI
- [ ] Enhanced search bar with filters
- [ ] Search results page
- [ ] Highlight matches in results
- [ ] Filter pills (category, solved, tags)

#### 5.4 Badge Display
- [ ] Badge icons (simple SVG)
- [ ] Badge showcase on profile
- [ ] Badge tooltip with description
- [ ] "New badge earned" toast notification

#### 5.5 Final Polish
- [ ] Empty states for all views
- [ ] Keyboard shortcuts (n = new post, / = search)
- [ ] Mobile responsive fixes
- [ ] Performance optimization (virtualized lists)
- [ ] Analytics events for key actions

### Definition of Done - Phase 5
- [ ] Search returns relevant results quickly
- [ ] Badges awarded automatically
- [ ] Profile shows earned badges
- [ ] Overall UX is polished and responsive

---

## UI/UX Design Specifications

### Layout Structure
```
┌─────────────────────────────────────────────────────────────────┐
│  Header: Community Hub                    [Search] [New Post]   │
├──────────────────────────────────────────────┬──────────────────┤
│                                              │   SIDEBAR        │
│  [All] [Questions] [Discussions] [Showcase]  │                  │
│                                              │   Your Stats     │
│  ┌─────────────────────────────────────────┐ │   ├ Rep: 450     │
│  │ ▲ 23  [Question] [Solved]               │ │   ├ Level: 3     │
│  │       How to configure multi-GPU...     │ │   └ Posts: 12    │
│  │       @alice · 2h ago · 5 comments      │ │                  │
│  │       [orchestrator] [gpu]              │ │   Top Tags       │
│  └─────────────────────────────────────────┘ │   ├ orchestrator │
│                                              │   ├ transcoding  │
│  ┌─────────────────────────────────────────┐ │   └ ai-pipeline  │
│  │ ▲ 15  [Discussion]                      │ │                  │
│  │       Best practices for...             │ │   Leaderboard    │
│  │       @bob · 1d ago · 12 comments       │ │   1. alice (890) │
│  │       [governance]                      │ │   2. bob (654)   │
│  └─────────────────────────────────────────┘ │   3. carol (432) │
│                                              │                  │
│  [Load More]                                 │                  │
└──────────────────────────────────────────────┴──────────────────┘
```

### Post Detail View
```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Forum                                                │
├─────────────────────────────────────────────────────────────────┤
│  ▲ 23                                                           │
│                                                                 │
│  How to configure multi-GPU orchestrator?          [Solved ✓]  │
│                                                                 │
│  @alice · Level 4 Expert · 2 hours ago                         │
│  [orchestrator] [gpu] [infrastructure]                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  I'm trying to run an orchestrator with 4x RTX 4090s but...    │
│                                                                 │
│  ```bash                                                        │
│  nvidia-smi                                                     │
│  ```                                                            │
│                                                                 │
│  [Edit] [Delete]                                                │
├─────────────────────────────────────────────────────────────────┤
│  5 Answers                                    [Sort: Best ▼]   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ✓ ACCEPTED ANSWER                           ▲ 12        │   │
│  │                                                         │   │
│  │ @bob · Level 5 Legend · 1 hour ago                     │   │
│  │                                                         │   │
│  │ You need to set CUDA_VISIBLE_DEVICES...                │   │
│  │                                                         │   │
│  │ ```yaml                                                 │   │
│  │ gpus: [0, 1, 2, 3]                                     │   │
│  │ ```                                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ @carol · Level 2 Contributor · 30 min ago    ▲ 3       │   │
│  │                                                         │   │
│  │ Also check your driver version...                      │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Write your answer...                                   │   │
│  │                                                         │   │
│  │  [B] [I] [Code] [Link]           [Preview] [Submit]    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Color Coding
- **Questions**: Blue badge (`#3b82f6`)
- **Discussions**: Purple badge (`#8b5cf6`)
- **Announcements**: Amber badge (`#f59e0b`)
- **Showcase**: Emerald badge (`#10b981`)
- **Solved**: Green checkmark (`#22c55e`)
- **Accepted Answer**: Green left border

### Reputation Level Colors
| Level | Color | Hex |
|-------|-------|-----|
| Newcomer | Gray | `#6b7280` |
| Contributor | Blue | `#3b82f6` |
| Regular | Cyan | `#06b6d4` |
| Trusted | Emerald | `#10b981` |
| Expert | Amber | `#f59e0b` |
| Legend | Purple | `#8b5cf6` |

---

## Technical Implementation Notes

### Minimum Coding Effort Strategy

1. **Reuse existing patterns**
   - Copy Prisma setup from other plugins (marketplace, gateway-manager)
   - Use existing auth middleware from base-svc
   - Leverage @naap/ui components (Card, Badge, Button, Input)

2. **Simple libraries**
   - Markdown: `marked` (lightweight, fast)
   - Syntax highlighting: `prism-react-renderer` (React-native)
   - Editor: Plain textarea + toolbar (no heavy WYSIWYG)

3. **Avoid complexity**
   - Single-level comments only (no nested threads)
   - Upvotes only (no downvotes = simpler logic)
   - PostgreSQL full-text search (no Elasticsearch)
   - No real-time updates (polling or manual refresh)

### File Changes Per Phase

**Phase 1** (~15 files)
```
backend/
  ├── prisma/schema.prisma (new)
  ├── prisma/seed.ts (new)
  ├── src/server.ts (update)
  ├── src/routes/posts.ts (new)
  ├── src/routes/users.ts (new)
  ├── src/middleware/auth.ts (new)
  └── src/types.ts (new)
frontend/
  ├── src/pages/Forum.tsx (update)
  ├── src/pages/PostDetail.tsx (new)
  ├── src/components/PostCard.tsx (new)
  ├── src/components/CreatePostModal.tsx (new)
  ├── src/hooks/usePosts.ts (new)
  └── src/api/client.ts (new)
```

**Phase 2** (~8 files)
```
backend/
  ├── prisma/schema.prisma (update - add votes)
  ├── src/routes/votes.ts (new)
  └── src/services/reputation.ts (new)
frontend/
  ├── src/components/VoteButton.tsx (new)
  ├── src/components/ReputationBadge.tsx (new)
  ├── src/components/Leaderboard.tsx (new)
  └── src/pages/Forum.tsx (update - sidebar)
```

**Phase 3** (~8 files)
```
backend/
  ├── prisma/schema.prisma (update - add comments)
  ├── src/routes/comments.ts (new)
  └── src/routes/posts.ts (update - accept answer)
frontend/
  ├── src/components/CommentList.tsx (new)
  ├── src/components/CommentEditor.tsx (new)
  ├── src/components/AcceptedAnswer.tsx (new)
  └── src/pages/PostDetail.tsx (update)
```

**Phase 4** (~6 files)
```
frontend/
  ├── src/components/MarkdownEditor.tsx (new)
  ├── src/components/MarkdownRenderer.tsx (new)
  ├── src/components/CodeBlock.tsx (new)
  ├── src/components/TemplateSelector.tsx (new)
  └── src/utils/markdown.ts (new)
```

**Phase 5** (~10 files)
```
backend/
  ├── prisma/schema.prisma (update - add badges)
  ├── src/routes/search.ts (new)
  ├── src/routes/badges.ts (new)
  └── src/services/badges.ts (new)
frontend/
  ├── src/pages/Search.tsx (new)
  ├── src/components/SearchBar.tsx (new)
  ├── src/components/BadgeDisplay.tsx (new)
  ├── src/components/BadgeToast.tsx (new)
  └── src/pages/Profile.tsx (new)
```

---

## Testing Strategy

### Per-Phase Testing Checklist

**Phase 1**
- [ ] API returns posts from database
- [ ] Creating post requires auth
- [ ] Post appears in list after creation
- [ ] Editing post updates content
- [ ] Deleting post removes from list

**Phase 2**
- [ ] Vote updates post count
- [ ] Cannot vote twice
- [ ] Reputation increases on vote received
- [ ] Level updates at thresholds
- [ ] Leaderboard sorts correctly

**Phase 3**
- [ ] Comments appear under post
- [ ] Can vote on comments
- [ ] Only author can accept answer
- [ ] Accepted answer shows first
- [ ] Post marked as solved

**Phase 4**
- [ ] Markdown renders headings, lists, links
- [ ] Code blocks have syntax colors
- [ ] Copy button copies code
- [ ] Templates insert correctly
- [ ] XSS attempts are sanitized

**Phase 5**
- [ ] Search finds posts by title
- [ ] Search finds posts by content
- [ ] Filters narrow results
- [ ] Badges awarded on criteria met
- [ ] Badge notifications appear

---

## Deployment Checklist

### Before Each Phase Release
- [ ] Run all tests
- [ ] Update version in plugin.json
- [ ] Update CHANGELOG.md
- [ ] Run database migration
- [ ] Build frontend (`npm run build`)
- [ ] Build backend (`npm run build`)
- [ ] Test in staging environment
- [ ] Smoke test core flows

### Production Deployment
- [ ] Backup database
- [ ] Run migrations
- [ ] Deploy backend
- [ ] Deploy frontend (rebuild plugin-server cache)
- [ ] Verify health checks
- [ ] Monitor for errors
- [ ] Announce to community

---

## Success Metrics

### Engagement Goals (30 days post-launch)
- 100+ registered users
- 50+ questions asked
- 200+ comments/answers
- 80%+ of questions receive at least 1 answer
- 50%+ of questions marked as solved

### Quality Indicators
- Average time to first answer: < 4 hours
- Average upvotes on accepted answers: > 5
- Search usage: 30%+ of sessions use search
- Return users: 40%+ weekly retention

---

## Timeline Summary

| Phase | Version | Duration | Key Deliverable |
|-------|---------|----------|-----------------|
| Phase 1 | v1.1.0 | 3-4 days | Real persistence + CRUD |
| Phase 2 | v1.1.1 | 2-3 days | Voting + reputation |
| Phase 3 | v1.1.2 | 3-4 days | Comments + accepted answers |
| Phase 4 | v1.1.3 | 2-3 days | Markdown + code highlighting |
| Phase 5 | v1.2.0 | 3-4 days | Search + badges + polish |
| **Total** | | **13-18 days** | |

---

## Next Steps

1. Review and approve this plan
2. Add community-db to docker-compose.yml
3. Begin Phase 1 implementation
4. Set up CI/CD for plugin testing

---

*Document Version: 1.0*
*Created: January 2026*
*Author: Claude Code*
