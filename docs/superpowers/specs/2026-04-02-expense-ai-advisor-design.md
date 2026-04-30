# Expense AI Advisor — Design Spec

## Overview

Add an inline AI advisor to the expense screen that proactively surfaces insights, visualizes spending patterns, and lets users ask natural language questions about their expenses. The same outputs are delivered through Telegram.

**Goal**: Make the expense screen feel like consulting a tax expert — contextual, accurate, visual, and actionable.

## Architecture

### 4 Zones

The advisor is embedded directly in the expense page (not a separate panel or chat widget). It consists of 4 zones that sit between the date/period selector and the expense list:

1. **Proactive Insight Cards** — horizontal scrollable strip of auto-generated alerts
2. **Smart Chart** — context-aware visualization with AI annotation
3. **Ask Bar** — natural language input with suggestion chips
4. **Agent Response** — rich answer area with inline charts and action buttons

### Data Flow

```
User opens expense page
  → Frontend fetches GET /api/v1/agentbook-expense/advisor/insights
  → Frontend fetches GET /api/v1/agentbook-expense/advisor/chart
  → Both use current period + filters as context

User asks a question in Ask Bar
  → POST /api/v1/agentbook-expense/advisor/ask { question, period }
  → Backend: builds expense context → calls Gemini LLM
  → Returns: { answer, chartData?, actions?, sources }
  → Frontend renders response with optional Recharts visualization

Same flow in Telegram
  → User sends expense question to bot
  → Bot calls same POST /api/v1/agentbook-expense/advisor/ask
  → Formats response as Telegram message + inline keyboard
  → Charts rendered as text tables (bullet lists with amounts)
```

### LLM Access

The `callGemini` helper is defined in the core plugin. Rather than creating a cross-plugin dependency, the expense plugin will implement its own `callGemini` using the same pattern: read `AbLLMProviderConfig` from DB, call the Gemini REST API. This is a ~20-line function, duplicated intentionally to keep plugins decoupled.

### Cross-Plugin Data

The expense plugin accesses `AbAccount` (core schema) for category names — this already works via the shared Prisma client. For conversation history, the `/advisor/ask` endpoint will log to `AbEvent` (which the expense plugin already uses) rather than `AbConversation` (which belongs to core). This keeps schema ownership clean.

### Auth & Tenant Isolation

All advisor endpoints follow the same pattern as existing expense endpoints: `(req as any).tenantId` from the `x-tenant-id` header, set by the Next.js proxy from the auth session cookie. No additional auth needed. Telegram bot passes tenant ID from the chat context, same as existing handlers.

## Backend

### New Endpoints (expense plugin)

All endpoints go in `plugins/agentbook-expense/backend/src/server.ts`.

**GET /api/v1/agentbook-expense/advisor/insights**

Returns proactive insight cards for the current period. Each insight has a type, severity, message, and optional action.

Parameters: `startDate`, `endDate` (from period selector)

Logic:
- **Spending spikes**: Compare each category to previous period. Flag if >20% increase.
- **Savings opportunities**: Detect monthly subscriptions that could be annual (heuristic: 3+ charges from same vendor in the last 6 months at similar amounts, <=10% variance).
- **Anomalies**: Find expenses >3x the rolling 90-day category average.
- **Missing receipts**: Count business expenses >$25 without receiptUrl.
- **Uncategorized**: Count expenses without categoryId.
- **Duplicate detection**: Find same vendorId + amount within 5% + date within 3 calendar days.

Response shape:
```typescript
{
  insights: [{
    id: string,
    type: 'spike' | 'saving' | 'anomaly' | 'missing_receipt' | 'uncategorized' | 'duplicate',
    severity: 'critical' | 'warning' | 'info',
    title: string,
    message: string,
    data: {              // typed per insight type
      categoryName?: string,
      currentCents?: number,
      previousCents?: number,
      changePercent?: number,
      vendorName?: string,
      expenseId?: string,
      count?: number,
      savingsCents?: number,
    },
    action?: { label: string, type: string, payload: any }
  }]
}
```

**GET /api/v1/agentbook-expense/advisor/chart**

Returns chart data for the smart visualization. The chart type and data adapt to the current context.

Parameters: `startDate`, `endDate`, `chartType` (bar | pie | trend), `compareStartDate`, `compareEndDate`

Response shape:
```typescript
{
  chartType: 'bar' | 'pie' | 'trend',
  title: string,
  subtitle: string,
  data: [{
    name: string,        // category or month name
    value: number,       // cents
    previousValue?: number,
    changePercent?: number,
    color?: string
  }],
  annotation: string     // AI-generated explanation of the chart
}
```

Annotation generation: Build a context string from the data, call Gemini with a prompt like "Explain this spending pattern in 1-2 sentences. Be specific about what changed and why." Fall back to a template-based annotation if LLM is unavailable.

**POST /api/v1/agentbook-expense/advisor/ask**

Accepts natural language questions about expenses. Uses a local `callGemini` function (same pattern as core plugin — reads LLM config from DB, calls Gemini REST API).

Request: `{ question: string, period?: { start: string, end: string } }`

Logic:
1. Build expense context: totals by category, top vendors, period comparison, recent anomalies
2. Include the question + context in a Gemini prompt with system instructions for financial advisor persona
3. Ask the LLM to return structured JSON: `{ answer, chartData?, suggestedActions? }`
4. If LLM returns chartData, include it for frontend rendering
5. Log to AbEvent (eventType: `advisor.question`) for audit trail

Fallback: If Gemini is unavailable, generate a template answer from the expense context data (e.g., "Your travel expenses total $4,710 across 5 transactions this period."). Never return an error for LLM failures — always return useful data.

Response shape:
```typescript
{
  answer: string,
  chartData?: {          // optional — only if the answer benefits from a chart
    type: 'bar' | 'pie' | 'trend',   // same types as /advisor/chart
    data: [{ name: string, value: number, previousValue?: number }]
  },
  actions?: [{ label: string, type: string }],
  sources: string[]      // which data was used (e.g., ["expenses", "categories", "vendors"])
}
```

### Telegram Integration

The Telegram bot handler adds a new intent detection path:

- If the message matches expense question patterns ("how much", "spending", "expenses", "travel costs", etc.), route to `/expense-advisor/ask`
- Format the response as a Telegram HTML message
- Add inline keyboard buttons for actions
- Charts are described in text (bullet lists with amounts) since Telegram doesn't render JS charts

No new Telegram-specific backend needed — the bot calls the same `/advisor/ask` endpoint.

## Frontend

### Dependencies

Add `recharts` to the expense plugin's `frontend/package.json` as a dependency. It will be bundled into the UMD build (same approach as the tax plugin, which bundles recharts into its UMD at ~80KB). The Vite UMD config externalizes only React/ReactDOM.

### Components

**AdvisorInsights** — Horizontal scrollable strip of insight cards.
- Each card: colored left border (red=critical, amber=warning, green=info), icon, title, message, action link
- Cards are dismissible (X button stores dismissed IDs in localStorage)
- Renders above the category cards

**AdvisorChart** — Recharts-powered visualization.
- Bar chart (default): categories on x-axis, amounts on y-axis, previous period as ghost bars
- Pie chart: category breakdown as donut
- Trend chart: monthly line chart
- Toggle buttons for chart type (bar/pie/trend)
- AI annotation text below the chart
- Renders between insight cards and the category cards

**AskBar** — Fixed-position input at the bottom of the advisor zone.
- Input field with placeholder: "Ask about your expenses..."
- Quick suggestion chips below: "Top spending?", "Any duplicates?", "Travel this quarter?"
- Send button
- Loading state with pulsing dot animation

**AdvisorResponse** — Rendered below the ask bar when a question is answered.
- Agent avatar + name
- Rich text answer
- Optional inline Recharts chart
- Action button chips
- Fade-in animation
- Dismissible (returns to just the ask bar)

### Layout in ExpenseList.tsx

```
[Date Period Selector]
[Proactive Insight Cards]     ← AdvisorInsights
[Smart Chart + Annotation]    ← AdvisorChart
[Category Cards Grid]         ← existing
[Ask Bar + Suggestions]       ← AskBar
[Agent Response]              ← AdvisorResponse (shown after asking)
[Search + Filters]            ← existing
[Expense Table/Cards]         ← existing
```

### State Management

All advisor state is local to the expense page (React useState). No global state needed.

```typescript
const [insights, setInsights] = useState([]);
const [chartData, setChartData] = useState(null);
const [advisorResponse, setAdvisorResponse] = useState(null);
const [asking, setAsking] = useState(false);
const [dismissedInsights, setDismissedInsights] = useState<string[]>(
  JSON.parse(localStorage.getItem('ab_dismissed_insights') || '[]')
);
```

Insights and chart data are fetched whenever the period changes (same useEffect as expenses).

### Loading & Empty States

- **AdvisorInsights loading**: Show 2 skeleton pulse cards (same height as real cards, muted background).
- **AdvisorInsights empty**: Hide the section entirely — don't show "no insights" when things are healthy.
- **AdvisorChart loading**: Show skeleton rectangle with pulsing animation.
- **AdvisorChart empty**: Show a placeholder: "Record a few more expenses to unlock spending insights."
- **AskBar**: Always visible (no loading state needed).
- **AdvisorResponse loading**: Show agent avatar with animated dots ("thinking...").
- **LLM failure**: The backend always returns data (template fallback). The frontend never sees an LLM error.

## Visual Design

- Insight cards: card background with colored left border (4px). Red for critical, amber for warning, emerald for info/saving. Clean text, no emoji overload — one icon per card.
- Chart: dark card background, Recharts with theme-consistent colors. Muted grid lines. Annotation text in small muted font below.
- Ask bar: looks like a search input but with an agent icon. Sits naturally in the page flow, not floating.
- Response: indented with agent avatar. Clean typography. Chart (if any) inside a bordered card. Action chips as outline buttons.
- All components use existing theme variables (--bg-card, --text-foreground, --border, --primary) so they work in light and dark mode.

## Testing

### E2E tests (Playwright, in `tests/e2e/expense-advisor.spec.ts`)
- Insights endpoint returns spending spikes when category increases >20%
- Insights endpoint returns anomaly when expense is >3x category average
- Insights endpoint returns duplicate when same vendor+amount within 3 days
- Insights returns empty array for fresh tenant
- Chart endpoint returns bar data with category breakdown
- Chart endpoint returns annotation string
- Ask endpoint answers "how much did I spend on travel?" with correct total
- Ask endpoint returns chartData for visual questions
- Ask endpoint falls back gracefully when LLM is unavailable
- All endpoints require tenant isolation (different tenants see different data)

## Out of Scope

- Image-based chart rendering for Telegram (text tables are sufficient for now)
- Conversation threading (each question is independent, though history is saved)
- Budget alerts and thresholds (future feature on top of this)
- Voice input in the ask bar
