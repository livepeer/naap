# Community Hub Plugin

Connect with the community through forums, discussions, and collaborative spaces.

## Features

- **Forum Posts**: Browse and create discussion threads
- **Categories**: Filter by topic (Infrastructure, Governance, AI Workloads)
- **Voting**: Upvote helpful posts
- **Search**: Find relevant discussions

## Installation

```bash
naap-plugin install community
```

## API Endpoints

### GET /api/v1/community/posts
Returns list of forum posts.

### GET /api/v1/community/posts/:id
Returns details for a specific post.

## Development

```bash
cd plugins/community
npm install
npm run dev
```

## License

MIT
