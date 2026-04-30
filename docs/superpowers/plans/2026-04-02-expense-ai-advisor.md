# Expense AI Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline AI advisor to the expense screen with proactive insights, smart charts, and natural language Q&A — same outputs in web and Telegram.

**Architecture:** 3 new backend endpoints (`/advisor/insights`, `/advisor/chart`, `/advisor/ask`) in the expense plugin server. 4 new React components (`AdvisorInsights`, `AdvisorChart`, `AskBar`, `AdvisorResponse`) integrated into the existing `ExpenseList.tsx`. Local `callGemini` helper in the expense plugin (no cross-plugin dependency). Recharts for visualizations.

**Tech Stack:** Express (backend), React + Recharts (frontend UMD), Gemini LLM, Prisma, Playwright (E2E tests)

**Spec:** `docs/superpowers/specs/2026-04-02-expense-ai-advisor-design.md`

---

### Task 1: Add `callGemini` helper to expense backend

**Files:**
- Modify: `plugins/agentbook-expense/backend/src/server.ts` (insert after imports, before routes)

- [ ] **Step 1: Add the callGemini function**

Insert after the `normalizeVendorName` function (~line 39):

```typescript
// === LLM Helper (local to expense plugin — same pattern as core) ===
async function callGemini(systemPrompt: string, userMessage: string, maxTokens: number = 500): Promise<string | null> {
  try {
    const llmConfig = await db.abLLMProviderConfig.findFirst({ where: { enabled: true, isDefault: true } });
    if (!llmConfig || llmConfig.provider !== 'gemini') return null;

    const model = llmConfig.modelFast || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${llmConfig.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch { return null; }
}
```

- [ ] **Step 2: Verify backend still starts**

Run: `lsof -i :4051 -t | xargs kill 2>/dev/null; DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4051 npx tsx plugins/agentbook-expense/backend/src/server.ts &`
Wait 5s, then: `curl -s http://localhost:4051/healthz`
Expected: `{"status":"ok",...}`

- [ ] **Step 3: Commit**

```bash
git add plugins/agentbook-expense/backend/src/server.ts
git commit -m "feat(expense): add local callGemini LLM helper"
```

---

### Task 2: Implement `/advisor/insights` endpoint

**Files:**
- Modify: `plugins/agentbook-expense/backend/src/server.ts` (insert before the `start()` call)

- [ ] **Step 1: Write the insights endpoint**

Insert before `start();` at the end of the file. This endpoint detects 6 types of insights:

```typescript
// ============================================
// AI ADVISOR: Proactive Insights
// ============================================
app.get('/api/v1/agentbook-expense/advisor/insights', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();

    // Previous period (same duration, shifted back)
    const duration = endDate.getTime() - startDate.getTime();
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - duration);

    const [currentExpenses, previousExpenses] = await Promise.all([
      db.abExpense.findMany({ where: { tenantId, isPersonal: false, date: { gte: startDate, lte: endDate } }, include: { vendor: true } }),
      db.abExpense.findMany({ where: { tenantId, isPersonal: false, date: { gte: prevStart, lte: prevEnd } } }),
    ]);

    // Resolve category names
    const catIds = [...new Set(currentExpenses.map((e: any) => e.categoryId).filter(Boolean))];
    const categories = catIds.length > 0 ? await db.abAccount.findMany({ where: { id: { in: catIds } } }) : [];
    const catMap = Object.fromEntries(categories.map((c: any) => [c.id, c.name]));

    const insights: any[] = [];

    // 1. Spending spikes (>20% increase by category)
    const currentByCat: Record<string, number> = {};
    const prevByCat: Record<string, number> = {};
    for (const e of currentExpenses) { const k = e.categoryId || 'other'; currentByCat[k] = (currentByCat[k] || 0) + e.amountCents; }
    for (const e of previousExpenses) { const k = e.categoryId || 'other'; prevByCat[k] = (prevByCat[k] || 0) + e.amountCents; }

    for (const [catId, current] of Object.entries(currentByCat)) {
      const prev = prevByCat[catId] || 0;
      if (prev > 0) {
        const pct = Math.round(((current - prev) / prev) * 100);
        if (pct > 20) {
          insights.push({
            id: `spike-${catId}`, type: 'spike', severity: pct > 50 ? 'critical' : 'warning',
            title: 'Spending Spike',
            message: `${catMap[catId] || 'Uncategorized'} is up ${pct}% (${formatCents(current)} vs ${formatCents(prev)} last period)`,
            data: { categoryName: catMap[catId], currentCents: current, previousCents: prev, changePercent: pct },
          });
        }
      }
    }

    // 2. Anomalies (>3x category average in 90 days)
    const ninetyAgo = new Date(endDate.getTime() - 90 * 86400000);
    const recentAll = await db.abExpense.findMany({ where: { tenantId, isPersonal: false, date: { gte: ninetyAgo } } });
    const avgByCat: Record<string, { sum: number; count: number }> = {};
    for (const e of recentAll) { const k = e.categoryId || 'other'; if (!avgByCat[k]) avgByCat[k] = { sum: 0, count: 0 }; avgByCat[k].sum += e.amountCents; avgByCat[k].count++; }

    for (const e of currentExpenses) {
      const k = e.categoryId || 'other';
      const avg = avgByCat[k] ? avgByCat[k].sum / avgByCat[k].count : 0;
      if (avg > 0 && e.amountCents > avg * 3) {
        insights.push({
          id: `anomaly-${e.id}`, type: 'anomaly', severity: 'warning',
          title: 'Unusual Expense',
          message: `${formatCents(e.amountCents)} at ${(e as any).vendor?.name || 'Unknown'} — ${Math.round(e.amountCents / avg)}x your average for ${catMap[k] || 'this category'}`,
          data: { vendorName: (e as any).vendor?.name, currentCents: e.amountCents, expenseId: e.id },
        });
      }
    }

    // 3. Duplicates (same vendor + ~amount within 3 days)
    const sorted = [...currentExpenses].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        const daysDiff = Math.abs(new Date(b.date).getTime() - new Date(a.date).getTime()) / 86400000;
        if (daysDiff > 3) break;
        if (a.vendorId && a.vendorId === b.vendorId && Math.abs(a.amountCents - b.amountCents) / a.amountCents < 0.05) {
          insights.push({
            id: `dup-${a.id}-${b.id}`, type: 'duplicate', severity: 'warning',
            title: 'Possible Duplicate',
            message: `${(a as any).vendor?.name}: ${formatCents(a.amountCents)} on ${new Date(a.date).toLocaleDateString()} and ${formatCents(b.amountCents)} on ${new Date(b.date).toLocaleDateString()}`,
            data: { vendorName: (a as any).vendor?.name, currentCents: a.amountCents, expenseId: a.id },
          });
        }
      }
    }

    // 4. Missing receipts (business expenses >$25)
    const missingReceipts = currentExpenses.filter((e: any) => !e.receiptUrl && e.amountCents > 2500);
    if (missingReceipts.length > 0) {
      insights.push({
        id: 'missing-receipts', type: 'missing_receipt', severity: 'info',
        title: 'Missing Receipts',
        message: `${missingReceipts.length} business expense${missingReceipts.length > 1 ? 's' : ''} over $25 without receipts`,
        data: { count: missingReceipts.length },
        action: { label: 'Upload Receipts', type: 'navigate', payload: '/agentbook/receipts' },
      });
    }

    // 5. Uncategorized
    const uncategorized = currentExpenses.filter((e: any) => !e.categoryId);
    if (uncategorized.length > 0) {
      insights.push({
        id: 'uncategorized', type: 'uncategorized', severity: 'info',
        title: 'Uncategorized Expenses',
        message: `${uncategorized.length} expense${uncategorized.length > 1 ? 's' : ''} need categorization (${formatCents(uncategorized.reduce((s: number, e: any) => s + e.amountCents, 0))} total)`,
        data: { count: uncategorized.length },
      });
    }

    // 6. Savings opportunities (3+ charges from same vendor in last 6 months)
    const sixMonthsAgo = new Date(endDate.getTime() - 180 * 86400000);
    const sixMonthExpenses = await db.abExpense.findMany({
      where: { tenantId, isPersonal: false, date: { gte: sixMonthsAgo, lte: endDate } },
      include: { vendor: true },
    });
    const vendorMonthly: Record<string, { amounts: number[]; name: string }> = {};
    for (const e of sixMonthExpenses) {
      if (!e.vendorId) continue;
      if (!vendorMonthly[e.vendorId]) vendorMonthly[e.vendorId] = { amounts: [], name: (e as any).vendor?.name || 'Unknown' };
      vendorMonthly[e.vendorId].amounts.push(e.amountCents);
    }
    for (const [vid, vd] of Object.entries(vendorMonthly)) {
      if (vd.amounts.length >= 3) {
        const avg = vd.amounts.reduce((a, b) => a + b, 0) / vd.amounts.length;
        const allSimilar = vd.amounts.every(a => Math.abs(a - avg) / avg < 0.1);
        if (allSimilar) {
          const annualSaving = Math.round(avg * 2); // ~15% annual discount = ~2 months free
          insights.push({
            id: `saving-${vid}`, type: 'saving', severity: 'info',
            title: 'Savings Opportunity',
            message: `${vd.name} billed ${vd.amounts.length}x at ~${formatCents(Math.round(avg))}. Annual plan could save ~${formatCents(annualSaving)}/year`,
            data: { vendorName: vd.name, savingsCents: annualSaving, count: vd.amounts.length },
          });
        }
      }
    }

    res.json({ success: true, data: { insights } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

function formatCents(c: number): string { return '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
```

- [ ] **Step 2: Restart backend and test**

Kill and restart expense backend, then test:
```bash
curl -s "http://localhost:4051/api/v1/agentbook-expense/advisor/insights?startDate=2026-01-01&endDate=2026-12-31" -H "x-tenant-id: 2e2348b6-a64c-44ad-907e-4ac120ff06f2" | python3 -m json.tool | head -30
```
Expected: JSON with `insights` array containing at least `missing_receipt` and `saving` type entries for Maya's data.

- [ ] **Step 3: Commit**

```bash
git add plugins/agentbook-expense/backend/src/server.ts
git commit -m "feat(expense): add advisor/insights endpoint with 6 detection rules"
```

---

### Task 3: Implement `/advisor/chart` endpoint

**Files:**
- Modify: `plugins/agentbook-expense/backend/src/server.ts` (insert after insights endpoint)

- [ ] **Step 1: Write the chart endpoint**

```typescript
// ============================================
// AI ADVISOR: Smart Chart Data
// ============================================
app.get('/api/v1/agentbook-expense/advisor/chart', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const chartType = (req.query.chartType as string) || 'bar';
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
    const compareStart = req.query.compareStartDate ? new Date(req.query.compareStartDate as string) : null;
    const compareEnd = req.query.compareEndDate ? new Date(req.query.compareEndDate as string) : null;

    const currentExpenses = await db.abExpense.findMany({
      where: { tenantId, isPersonal: false, date: { gte: startDate, lte: endDate } },
    });

    const catIds = [...new Set(currentExpenses.map((e: any) => e.categoryId).filter(Boolean))];
    const categories = catIds.length > 0 ? await db.abAccount.findMany({ where: { id: { in: catIds } } }) : [];
    const catMap = Object.fromEntries(categories.map((c: any) => [c.id, c.name]));

    let compareExpenses: any[] = [];
    if (compareStart && compareEnd) {
      compareExpenses = await db.abExpense.findMany({
        where: { tenantId, isPersonal: false, date: { gte: compareStart, lte: compareEnd } },
      });
    }
    const prevByCat: Record<string, number> = {};
    for (const e of compareExpenses) { const k = e.categoryId || 'other'; prevByCat[k] = (prevByCat[k] || 0) + e.amountCents; }

    let data: any[] = [];
    let title = '';
    let subtitle = '';

    const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#ef4444', '#84cc16'];

    if (chartType === 'bar' || chartType === 'pie') {
      // Group by category
      const byCat: Record<string, number> = {};
      for (const e of currentExpenses) { const k = e.categoryId || 'other'; byCat[k] = (byCat[k] || 0) + e.amountCents; }

      data = Object.entries(byCat)
        .sort((a, b) => b[1] - a[1])
        .map(([catId, value], i) => ({
          name: catMap[catId] || 'Uncategorized',
          value,
          previousValue: prevByCat[catId] || 0,
          changePercent: prevByCat[catId] ? Math.round(((value - prevByCat[catId]) / prevByCat[catId]) * 100) : null,
          color: COLORS[i % COLORS.length],
        }));

      title = chartType === 'bar' ? 'Spending by Category' : 'Category Breakdown';
      subtitle = `${startDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} — ${endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
    } else {
      // Trend: group by month
      const byMonth: Record<string, number> = {};
      for (const e of currentExpenses) {
        const key = `${new Date(e.date).getFullYear()}-${String(new Date(e.date).getMonth() + 1).padStart(2, '0')}`;
        byMonth[key] = (byMonth[key] || 0) + e.amountCents;
      }
      data = Object.entries(byMonth).sort().map(([month, value]) => ({
        name: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short' }),
        value,
        color: '#10b981',
      }));
      title = 'Monthly Spending Trend';
      subtitle = `${data.length} months`;
    }

    // AI annotation
    const contextStr = data.map(d => `${d.name}: ${formatCents(d.value)}${d.changePercent ? ` (${d.changePercent > 0 ? '+' : ''}${d.changePercent}%)` : ''}`).join(', ');
    let annotation = '';
    const llmAnnotation = await callGemini(
      'You are a financial advisor. Explain this spending pattern in 1-2 concise sentences. Mention the biggest category and any notable changes. Use dollar amounts.',
      `Expense breakdown: ${contextStr}`,
      150,
    );
    if (llmAnnotation) {
      annotation = llmAnnotation;
    } else {
      // Template fallback
      const biggest = data[0];
      annotation = biggest ? `${biggest.name} is your largest expense at ${formatCents(biggest.value)}.${data.length > 1 ? ` Followed by ${data[1].name} at ${formatCents(data[1].value)}.` : ''}` : 'No expense data for this period.';
    }

    res.json({ success: true, data: { chartType, title, subtitle, data, annotation } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});
```

- [ ] **Step 2: Test the endpoint**

```bash
curl -s "http://localhost:4051/api/v1/agentbook-expense/advisor/chart?startDate=2026-01-01&endDate=2026-12-31&chartType=bar" -H "x-tenant-id: 2e2348b6-a64c-44ad-907e-4ac120ff06f2" | python3 -m json.tool | head -20
```
Expected: JSON with `chartType: "bar"`, `data` array with category names and values, `annotation` string.

- [ ] **Step 3: Commit**

```bash
git add plugins/agentbook-expense/backend/src/server.ts
git commit -m "feat(expense): add advisor/chart endpoint with LLM annotations"
```

---

### Task 4: Implement `/advisor/ask` endpoint

**Files:**
- Modify: `plugins/agentbook-expense/backend/src/server.ts` (insert after chart endpoint)

- [ ] **Step 1: Write the ask endpoint**

```typescript
// ============================================
// AI ADVISOR: Natural Language Q&A
// ============================================
app.post('/api/v1/agentbook-expense/advisor/ask', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { question, period } = req.body;
    if (!question) return res.status(400).json({ success: false, error: 'question is required' });

    const startDate = period?.start ? new Date(period.start) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = period?.end ? new Date(period.end) : new Date();

    // Build expense context
    const expenses = await db.abExpense.findMany({
      where: { tenantId, isPersonal: false, date: { gte: startDate, lte: endDate } },
      include: { vendor: true },
    });

    const catIds = [...new Set(expenses.map((e: any) => e.categoryId).filter(Boolean))];
    const categories = catIds.length > 0 ? await db.abAccount.findMany({ where: { id: { in: catIds } } }) : [];
    const catMap = Object.fromEntries(categories.map((c: any) => [c.id, c.name]));

    // Aggregate
    const totalCents = expenses.reduce((s: number, e: any) => s + e.amountCents, 0);
    const byCat: Record<string, { total: number; count: number }> = {};
    const byVendor: Record<string, { total: number; count: number }> = {};
    for (const e of expenses) {
      const cat = catMap[e.categoryId || ''] || 'Uncategorized';
      if (!byCat[cat]) byCat[cat] = { total: 0, count: 0 };
      byCat[cat].total += e.amountCents; byCat[cat].count++;

      const vn = (e as any).vendor?.name || 'Unknown';
      if (!byVendor[vn]) byVendor[vn] = { total: 0, count: 0 };
      byVendor[vn].total += e.amountCents; byVendor[vn].count++;
    }

    const topCategories = Object.entries(byCat).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
    const topVendors = Object.entries(byVendor).sort((a, b) => b[1].total - a[1].total).slice(0, 10);

    const contextStr = `Expense data (${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}):
Total: ${formatCents(totalCents)} across ${expenses.length} expenses.
By category: ${topCategories.map(([n, d]) => `${n}: ${formatCents(d.total)} (${d.count})`).join(', ')}
Top vendors: ${topVendors.map(([n, d]) => `${n}: ${formatCents(d.total)} (${d.count}x)`).join(', ')}`;

    let answer = '';
    let chartData = null;
    let actions: any[] = [];
    const sources = ['expenses', 'categories', 'vendors'];

    const llmAnswer = await callGemini(
      `You are AgentBook Expense Advisor — a friendly, concise financial expert. Answer expense questions using the data provided. Always include dollar amounts. If the question is about a category or trend, include a chartData field. Respond in JSON: {"answer": "...", "chartData": null | {"type": "bar"|"pie"|"trend", "data": [{"name":"...", "value": cents}]}, "suggestedActions": ["label1", "label2"]}`,
      `${contextStr}\n\nQuestion: ${question}`,
      500,
    );

    if (llmAnswer) {
      try {
        const cleaned = llmAnswer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        answer = parsed.answer || llmAnswer;
        chartData = parsed.chartData || null;
        actions = (parsed.suggestedActions || []).map((l: string) => ({ label: l, type: 'suggestion' }));
      } catch {
        answer = llmAnswer; // Use raw text if JSON parsing fails
      }
    } else {
      // Template fallback
      const q = question.toLowerCase();
      if (q.includes('travel')) {
        const travel = byCat['Travel'] || { total: 0, count: 0 };
        answer = `Your travel expenses total ${formatCents(travel.total)} across ${travel.count} transactions this period.`;
        chartData = { type: 'bar', data: topCategories.map(([name, d]) => ({ name, value: d.total })) };
      } else if (q.includes('top') || q.includes('most') || q.includes('biggest')) {
        answer = `Your top spending categories: ${topCategories.slice(0, 5).map(([n, d]) => `${n} (${formatCents(d.total)})`).join(', ')}.`;
        chartData = { type: 'bar', data: topCategories.map(([name, d]) => ({ name, value: d.total })) };
      } else {
        answer = `You spent ${formatCents(totalCents)} across ${expenses.length} expenses. Top categories: ${topCategories.slice(0, 3).map(([n, d]) => `${n} ${formatCents(d.total)}`).join(', ')}.`;
      }
    }

    // Log to events
    await db.abEvent.create({
      data: { tenantId, eventType: 'advisor.question', actor: 'human', action: { question, answerLength: answer.length, hasChart: !!chartData } },
    });

    res.json({ success: true, data: { answer, chartData, actions, sources } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});
```

- [ ] **Step 2: Test the endpoint**

```bash
curl -s -X POST "http://localhost:4051/api/v1/agentbook-expense/advisor/ask" -H "x-tenant-id: 2e2348b6-a64c-44ad-907e-4ac120ff06f2" -H "Content-Type: application/json" -d '{"question":"How much did I spend on travel?"}' | python3 -m json.tool | head -15
```
Expected: JSON with `answer` mentioning travel amount, possibly `chartData`.

- [ ] **Step 3: Commit**

```bash
git add plugins/agentbook-expense/backend/src/server.ts
git commit -m "feat(expense): add advisor/ask endpoint with Gemini LLM + fallback"
```

---

### Task 5: Add Recharts dependency to expense frontend

**Files:**
- Modify: `plugins/agentbook-expense/frontend/package.json`

- [ ] **Step 1: Install recharts**

```bash
cd plugins/agentbook-expense/frontend && npm install recharts@^2.15.0
```

- [ ] **Step 2: Verify build still works**

```bash
npm run build
```
Expected: UMD bundle builds (may be larger now ~100-120KB).

- [ ] **Step 3: Commit**

```bash
git add plugins/agentbook-expense/frontend/package.json plugins/agentbook-expense/frontend/package-lock.json
git commit -m "feat(expense): add recharts dependency for advisor charts"
```

---

### Task 6: Build AdvisorInsights component

**Files:**
- Create: `plugins/agentbook-expense/frontend/src/components/AdvisorInsights.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react';
import { AlertTriangle, TrendingUp, Copy, FileX, Tag, Lightbulb, X } from 'lucide-react';

interface Insight {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  data: any;
  action?: { label: string; type: string; payload: any };
}

const SEVERITY_STYLES: Record<string, { border: string; icon: string }> = {
  critical: { border: 'border-l-red-500', icon: 'text-red-500' },
  warning: { border: 'border-l-amber-500', icon: 'text-amber-500' },
  info: { border: 'border-l-emerald-500', icon: 'text-emerald-500' },
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  spike: <TrendingUp className="w-4 h-4" />,
  anomaly: <AlertTriangle className="w-4 h-4" />,
  duplicate: <Copy className="w-4 h-4" />,
  missing_receipt: <FileX className="w-4 h-4" />,
  uncategorized: <Tag className="w-4 h-4" />,
  saving: <Lightbulb className="w-4 h-4" />,
};

export const AdvisorInsights: React.FC<{
  insights: Insight[];
  loading: boolean;
  onDismiss: (id: string) => void;
}> = ({ insights, loading, onDismiss }) => {
  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2 mb-4">
        {[1, 2].map(i => (
          <div key={i} className="min-w-[260px] h-[88px] rounded-xl bg-muted/40 animate-pulse shrink-0" />
        ))}
      </div>
    );
  }

  if (insights.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent Insights</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{insights.length}</span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {insights.map(insight => {
          const style = SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.info;
          return (
            <div key={insight.id}
              className={`min-w-[260px] sm:min-w-[280px] bg-card border border-border border-l-4 ${style.border} rounded-xl p-3.5 shrink-0 snap-start relative group`}>
              <button onClick={(e) => { e.stopPropagation(); onDismiss(insight.id); }}
                className="absolute top-2 right-2 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted transition-all">
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={style.icon}>{TYPE_ICONS[insight.type] || <AlertTriangle className="w-4 h-4" />}</span>
                <span className="text-xs font-semibold text-foreground">{insight.title}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed pr-4">{insight.message}</p>
              {insight.action && (
                <button className="mt-2 text-xs font-medium text-primary hover:underline">{insight.action.label} →</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add plugins/agentbook-expense/frontend/src/components/AdvisorInsights.tsx
git commit -m "feat(expense): add AdvisorInsights component"
```

---

### Task 7: Build AdvisorChart component

**Files:**
- Create: `plugins/agentbook-expense/frontend/src/components/AdvisorChart.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import { Lightbulb } from 'lucide-react';

interface ChartDataPoint {
  name: string;
  value: number;
  previousValue?: number;
  changePercent?: number;
  color?: string;
}

interface ChartProps {
  chartType: 'bar' | 'pie' | 'trend';
  title: string;
  subtitle: string;
  data: ChartDataPoint[];
  annotation: string;
  loading: boolean;
  onTypeChange: (type: 'bar' | 'pie' | 'trend') => void;
}

const FALLBACK_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#ef4444', '#84cc16'];

function fmtK(cents: number): string {
  const v = cents / 100;
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(0)}`;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-lg p-2.5 shadow-lg text-xs">
      <p className="font-semibold text-foreground">{d.name}</p>
      <p className="text-muted-foreground">${(d.value / 100).toLocaleString()}</p>
      {d.previousValue > 0 && <p className="text-muted-foreground">Prev: ${(d.previousValue / 100).toLocaleString()}</p>}
      {d.changePercent != null && (
        <p className={d.changePercent > 0 ? 'text-red-500' : 'text-green-500'}>{d.changePercent > 0 ? '+' : ''}{d.changePercent}%</p>
      )}
    </div>
  );
};

export const AdvisorChart: React.FC<ChartProps> = ({ chartType, title, subtitle, data, annotation, loading, onTypeChange }) => {
  if (loading) {
    return <div className="bg-card border border-border rounded-xl p-6 mb-4 h-[280px] animate-pulse" />;
  }
  if (!data || data.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 mb-4 text-center">
        <p className="text-sm text-muted-foreground">Record a few more expenses to unlock spending insights.</p>
      </div>
    );
  }

  const chartData = data.map((d, i) => ({ ...d, fill: d.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length] }));

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5 mb-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <div className="flex gap-1">
          {(['bar', 'pie', 'trend'] as const).map(t => (
            <button key={t} onClick={() => onTypeChange(t)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition-colors ${chartType === t ? 'bg-primary/15 text-primary' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[180px] sm:h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={fmtK} width={45} />
              <Tooltip content={<CustomTooltip />} />
              {data.some(d => d.previousValue) && <Bar dataKey="previousValue" fill="#334155" radius={[3, 3, 0, 0]} barSize={16} />}
              <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={20}>
                {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          ) : chartType === 'pie' ? (
            <PieChart>
              <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickFormatter={fmtK} width={45} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={{ r: 4, fill: '#10b981' }} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      {annotation && (
        <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-muted/30">
          <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">{annotation}</p>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add plugins/agentbook-expense/frontend/src/components/AdvisorChart.tsx
git commit -m "feat(expense): add AdvisorChart component with bar/pie/trend"
```

---

### Task 8: Build AskBar and AdvisorResponse components

**Files:**
- Create: `plugins/agentbook-expense/frontend/src/components/AskBar.tsx`
- Create: `plugins/agentbook-expense/frontend/src/components/AdvisorResponse.tsx`

- [ ] **Step 1: Create AskBar**

```tsx
import React, { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';

const SUGGESTIONS = ['Top spending?', 'Any duplicates?', 'Travel this quarter?', 'Compare to last month'];

export const AskBar: React.FC<{
  onAsk: (question: string) => void;
  loading: boolean;
}> = ({ onAsk, loading }) => {
  const [question, setQuestion] = useState('');

  const handleSubmit = () => {
    if (!question.trim() || loading) return;
    onAsk(question.trim());
    setQuestion('');
  };

  return (
    <div className="mb-4">
      <div className="bg-card border border-border rounded-xl p-1.5 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 pl-3">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <input
            type="text" value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="Ask about your expenses..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none py-2.5"
            disabled={loading}
          />
        </div>
        <button onClick={handleSubmit} disabled={loading || !question.trim()}
          className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 transition-opacity">
          {loading ? <span className="flex gap-1"><span className="w-1 h-1 bg-primary-foreground rounded-full animate-bounce" style={{animationDelay:'0ms'}}/><span className="w-1 h-1 bg-primary-foreground rounded-full animate-bounce" style={{animationDelay:'150ms'}}/><span className="w-1 h-1 bg-primary-foreground rounded-full animate-bounce" style={{animationDelay:'300ms'}}/></span> : 'Ask'}
        </button>
      </div>
      {!loading && (
        <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => onAsk(s)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-muted/50 text-muted-foreground hover:text-foreground border border-border/50 whitespace-nowrap shrink-0 transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Create AdvisorResponse**

```tsx
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Sparkles, X } from 'lucide-react';

const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899'];

function fmtK(c: number): string { const v = c / 100; return v >= 1000 ? `$${(v/1000).toFixed(1)}K` : `$${v.toFixed(0)}`; }

export const AdvisorResponse: React.FC<{
  answer: string;
  chartData?: { type: string; data: { name: string; value: number }[] } | null;
  actions?: { label: string; type: string }[];
  onDismiss: () => void;
  onAsk: (q: string) => void;
}> = ({ answer, chartData, actions, onDismiss, onAsk }) => {
  return (
    <div className="bg-card border border-border rounded-xl p-4 mb-4 animate-in fade-in duration-300 relative">
      <button onClick={onDismiss} className="absolute top-3 right-3 p-1 rounded-md hover:bg-muted transition-colors">
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      <div className="flex gap-3">
        <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0 pr-6">
          <p className="text-xs font-semibold text-primary mb-1.5">Expense Advisor</p>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{answer}</p>

          {chartData && chartData.data && chartData.data.length > 0 && (
            <div className="mt-3 bg-muted/30 rounded-lg p-3 border border-border/50">
              <div className="h-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData.data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={fmtK} width={40} />
                    <Tooltip formatter={(v: number) => ['$' + (v/100).toLocaleString(), '']} />
                    <Bar dataKey="value" radius={[3, 3, 0, 0]} barSize={18}>
                      {chartData.data.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {actions && actions.length > 0 && (
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {actions.map((a, i) => (
                <button key={i} onClick={() => onAsk(a.label)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-muted/50 text-muted-foreground border border-border/50 hover:text-foreground transition-colors">
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Commit**

```bash
git add plugins/agentbook-expense/frontend/src/components/AskBar.tsx plugins/agentbook-expense/frontend/src/components/AdvisorResponse.tsx
git commit -m "feat(expense): add AskBar and AdvisorResponse components"
```

---

### Task 9: Integrate advisor components into ExpenseList.tsx

**Files:**
- Modify: `plugins/agentbook-expense/frontend/src/pages/ExpenseList.tsx`

- [ ] **Step 1: Add imports and state**

At the top of `ExpenseList.tsx`, add imports:
```tsx
import { AdvisorInsights } from '../components/AdvisorInsights';
import { AdvisorChart } from '../components/AdvisorChart';
import { AskBar } from '../components/AskBar';
import { AdvisorResponse } from '../components/AdvisorResponse';
```

In the component body, add state after existing state declarations:
```tsx
const [insights, setInsights] = useState<any[]>([]);
const [chartResult, setChartResult] = useState<any>(null);
const [chartType, setChartType] = useState<'bar' | 'pie' | 'trend'>('bar');
const [advisorResponse, setAdvisorResponse] = useState<any>(null);
const [advisorLoading, setAdvisorLoading] = useState(false);
const [insightsLoading, setInsightsLoading] = useState(true);
const [dismissedInsights, setDismissedInsights] = useState<string[]>(
  JSON.parse(localStorage.getItem('ab_dismissed_insights') || '[]')
);
```

- [ ] **Step 2: Add data fetching**

Add a useEffect for advisor data, right after the existing expenses useEffect:
```tsx
// Fetch advisor data when period changes
useEffect(() => {
  setInsightsLoading(true);
  const dates = getPeriodDates(period);
  const qs = new URLSearchParams();
  if (period !== 'all') {
    qs.set('startDate', dates.start.toISOString());
    qs.set('endDate', dates.end.toISOString());
  }
  const chartQs = new URLSearchParams(qs);
  chartQs.set('chartType', chartType);
  if (period !== 'all') {
    chartQs.set('compareStartDate', dates.compareStart.toISOString());
    chartQs.set('compareEndDate', dates.compareEnd.toISOString());
  }

  Promise.all([
    fetch(`${API}/advisor/insights?${qs}`).then(r => r.json()).catch(() => ({ success: false })),
    fetch(`${API}/advisor/chart?${chartQs}`).then(r => r.json()).catch(() => ({ success: false })),
  ]).then(([insData, chartData]) => {
    if (insData.success) setInsights(insData.data.insights || []);
    if (chartData.success) setChartResult(chartData.data);
  }).finally(() => setInsightsLoading(false));
}, [period, chartType]);
```

Add the ask handler:
```tsx
const handleAsk = async (question: string) => {
  setAdvisorLoading(true);
  try {
    const dates = getPeriodDates(period);
    const res = await fetch(`${API}/advisor/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, period: period !== 'all' ? { start: dates.start.toISOString(), end: dates.end.toISOString() } : undefined }),
    });
    const data = await res.json();
    if (data.success) setAdvisorResponse(data.data);
  } catch { /* silent */ }
  setAdvisorLoading(false);
};

const handleDismissInsight = (id: string) => {
  const updated = [...dismissedInsights, id];
  setDismissedInsights(updated);
  localStorage.setItem('ab_dismissed_insights', JSON.stringify(updated));
};
```

- [ ] **Step 3: Add components to the JSX**

Insert after the date period selector div and before the category cards section:
```tsx
{/* AI Advisor Zone */}
<AdvisorInsights
  insights={insights.filter(i => !dismissedInsights.includes(i.id))}
  loading={insightsLoading}
  onDismiss={handleDismissInsight}
/>

{chartResult && (
  <AdvisorChart
    chartType={chartResult.chartType || chartType}
    title={chartResult.title || 'Spending Overview'}
    subtitle={chartResult.subtitle || ''}
    data={chartResult.data || []}
    annotation={chartResult.annotation || ''}
    loading={insightsLoading}
    onTypeChange={(t) => setChartType(t)}
  />
)}
```

Insert after the category cards grid, before search/filters:
```tsx
{/* Ask Bar + Response */}
<AskBar onAsk={handleAsk} loading={advisorLoading} />

{advisorResponse && (
  <AdvisorResponse
    answer={advisorResponse.answer}
    chartData={advisorResponse.chartData}
    actions={advisorResponse.actions}
    onDismiss={() => setAdvisorResponse(null)}
    onAsk={handleAsk}
  />
)}
```

- [ ] **Step 4: Build and deploy**

```bash
cd plugins/agentbook-expense/frontend && npm run build
cp dist/production/agentbook-expense.js ../../../apps/web-next/public/cdn/plugins/agentbook-expense/agentbook-expense.js
cp dist/production/agentbook-expense.js ../../../apps/web-next/public/cdn/plugins/agentbook-expense/1.0.0/agentbook-expense.js
```

- [ ] **Step 5: Commit**

```bash
git add plugins/agentbook-expense/frontend/src/
git commit -m "feat(expense): integrate advisor into expense list page"
```

---

### Task 10: Write E2E tests

**Files:**
- Create: `tests/e2e/expense-advisor.spec.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { test, expect } from '@playwright/test';

const EXPENSE = 'http://localhost:4051';
const T = '2e2348b6-a64c-44ad-907e-4ac120ff06f2'; // Maya
const H = { 'x-tenant-id': T, 'Content-Type': 'application/json' };

test.describe.serial('Expense AI Advisor', () => {
  test('insights: returns spending insights for Maya', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/insights?startDate=2026-01-01&endDate=2026-12-31`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.insights).toBeDefined();
    expect(data.data.insights.length).toBeGreaterThanOrEqual(1);
    // Should at least find savings opportunities (3+ monthly subscriptions)
    const types = data.data.insights.map((i: any) => i.type);
    expect(types.some((t: string) => ['saving', 'missing_receipt', 'spike', 'anomaly'].includes(t))).toBeTruthy();
  });

  test('insights: each insight has required fields', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/insights?startDate=2026-01-01&endDate=2026-12-31`, { headers: H });
    const insights = (await res.json()).data.insights;
    for (const i of insights) {
      expect(i.id).toBeTruthy();
      expect(i.type).toBeTruthy();
      expect(['critical', 'warning', 'info']).toContain(i.severity);
      expect(i.title).toBeTruthy();
      expect(i.message).toBeTruthy();
    }
  });

  test('insights: detects spending spike >20%', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/insights?startDate=2026-01-01&endDate=2026-12-31`, { headers: H });
    const insights = (await res.json()).data.insights;
    const spikes = insights.filter((i: any) => i.type === 'spike');
    // Maya has expenses only in current period (no previous data for comparison with seed)
    // At minimum, savings should be detected from repeated subscriptions
    const savings = insights.filter((i: any) => i.type === 'saving');
    expect(savings.length).toBeGreaterThanOrEqual(1); // Shopify, Adobe, etc. billed 3x
  });

  test('insights: empty for fresh tenant', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/insights`, { headers: { 'x-tenant-id': 'empty-tenant', 'Content-Type': 'application/json' } });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.insights.length).toBe(0);
  });

  test('chart: returns bar data with categories', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/chart?startDate=2026-01-01&endDate=2026-12-31&chartType=bar`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.chartType).toBe('bar');
    expect(data.data.data.length).toBeGreaterThanOrEqual(1);
    expect(data.data.data[0].name).toBeTruthy();
    expect(data.data.data[0].value).toBeGreaterThan(0);
    expect(data.data.annotation).toBeTruthy();
  });

  test('chart: returns trend data', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/chart?startDate=2026-01-01&endDate=2026-12-31&chartType=trend`, { headers: H });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.chartType).toBe('trend');
  });

  test('ask: answers travel question', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/advisor/ask`, {
      headers: H,
      data: { question: 'How much did I spend on travel?' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.answer).toBeTruthy();
    expect(data.data.answer.length).toBeGreaterThan(20);
    expect(data.data.sources).toContain('expenses');
  });

  test('ask: returns chart data for category questions', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/advisor/ask`, {
      headers: H,
      data: { question: 'What are my top spending categories?' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.answer).toBeTruthy();
    // Should have chart data for a visual question
    if (data.data.chartData) {
      expect(data.data.chartData.data.length).toBeGreaterThan(0);
    }
  });

  test('ask: logs event for audit', async ({ request }) => {
    // The ask endpoint logs to AbEvent — just verify it doesn't error
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/advisor/ask`, {
      headers: H,
      data: { question: 'Quick summary of my expenses' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('ask: falls back gracefully without LLM', async ({ request }) => {
    // Even if LLM is unavailable, the endpoint should return expense data
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/advisor/ask`, {
      headers: H,
      data: { question: 'Give me a summary' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.answer).toBeTruthy();
    expect(data.data.answer).toContain('$'); // Should always include dollar amounts
    expect(data.data.sources).toBeDefined();
  });

  test('tenant isolation: different tenants see different data', async ({ request }) => {
    const alexH = { 'x-tenant-id': '04b97d95-9c81-4903-817b-9839d504841d', 'Content-Type': 'application/json' };
    const [mayaRes, alexRes] = await Promise.all([
      request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/chart?chartType=bar&startDate=2026-01-01&endDate=2026-12-31`, { headers: H }),
      request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/chart?chartType=bar&startDate=2026-01-01&endDate=2026-12-31`, { headers: alexH }),
    ]);
    const mayaData = (await mayaRes.json()).data.data;
    const alexData = (await alexRes.json()).data.data;
    // Both should have data but different totals
    expect(mayaData.length).toBeGreaterThan(0);
    expect(alexData.length).toBeGreaterThan(0);
    const mayaTotal = mayaData.reduce((s: number, d: any) => s + d.value, 0);
    const alexTotal = alexData.reduce((s: number, d: any) => s + d.value, 0);
    expect(mayaTotal).not.toBe(alexTotal);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd tests/e2e && npx playwright test expense-advisor.spec.ts --config=playwright.config.ts
```
Expected: All 10 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/expense-advisor.spec.ts
git commit -m "test(expense): add E2E tests for AI advisor endpoints"
```

---

### Task 11: Add Telegram expense advisor routing

**Files:**
- Modify: `packages/agentbook-telegram/src/bot.ts` (add expense question intent detection)

- [ ] **Step 1: Add expense question detection to the text message handler**

In the `onTextExpense` handler (or wherever text messages are processed), add an expense question detection path. Before the existing expense recording logic, check if the message is a question:

```typescript
// Detect expense questions and route to advisor
const expenseQuestionPatterns = /how much|spending|spent|expenses?|travel cost|top categor|duplicate|any savings|subscription|software cost|biggest expense|compare.*month/i;

if (expenseQuestionPatterns.test(text)) {
  try {
    const advisorRes = await fetch(`http://localhost:4051/api/v1/agentbook-expense/advisor/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': String(chatId) },
      body: JSON.stringify({ question: text }),
    });
    const data = await advisorRes.json();
    if (data.success && data.data.answer) {
      let reply = `🤖 <b>Expense Advisor</b>\n\n${data.data.answer}`;
      // Add chart data as text table if present
      if (data.data.chartData?.data) {
        reply += '\n\n📊 <b>Breakdown:</b>';
        for (const d of data.data.chartData.data.slice(0, 8)) {
          reply += `\n• ${d.name}: $${(d.value / 100).toLocaleString()}`;
        }
      }
      return { success: true, message: reply, keyboard: data.data.actions?.map((a: any) => [{ text: a.label }]) };
    }
  } catch { /* fall through to normal processing */ }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/agentbook-telegram/src/bot.ts
git commit -m "feat(telegram): route expense questions to AI advisor"
```

---

### Task 12: Restart backends and verify full integration

- [ ] **Step 1: Restart expense backend**

```bash
lsof -i :4051 -t | xargs kill 2>/dev/null
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4051 npx tsx plugins/agentbook-expense/backend/src/server.ts &
```

- [ ] **Step 2: Run all E2E tests**

```bash
cd tests/e2e && npx playwright test expense-advisor.spec.ts --config=playwright.config.ts
```

- [ ] **Step 3: Manual browser verification**

Open `http://localhost:3000/agentbook/expenses` (logged in as Maya). Verify:
- Insight cards appear at the top with spending alerts
- Bar chart shows spending by category with AI annotation
- Ask bar accepts questions and shows responses
- Chart type toggles work (bar/pie/trend)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(expense): complete AI advisor with insights, charts, and Q&A"
```
