/**
 * AgentBook Persona Seed Script
 * Seeds 3 realistic user personas with full financial data for walkthrough testing.
 *
 * Usage:
 *   npx tsx agentbook/seed-personas.ts
 *
 * Requires backends running on ports 4050-4053.
 * Creates tenants: maya-consultant, alex-agency, jordan-sidehustle
 */

const CORE = 'http://localhost:4050';
const EXPENSE = 'http://localhost:4051';
const INVOICE = 'http://localhost:4052';
const TAX = 'http://localhost:4053';

function h(tenantId: string) {
  return { 'x-tenant-id': tenantId, 'Content-Type': 'application/json' };
}

const TS = Date.now().toString(36); // short unique suffix

async function post(url: string, headers: Record<string, string>, data: any) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data) });
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok && !json.success) console.warn(`  WARN: ${url} → ${json.error || res.status}`);
    return json;
  } catch {
    console.warn(`  WARN: POST ${url} → non-JSON (${res.status})`);
    return { success: false };
  }
}

async function put(url: string, headers: Record<string, string>, data: any) {
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(data) });
  return res.json();
}

async function get(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { console.warn(`  WARN: GET ${url} → non-JSON response (${res.status})`); return { success: false }; }
}

// ============================================
// PERSONA 1: Maya — IT Consultant, Toronto, Canada
// Revenue: ~$180K CAD, 3 clients, T2125 filer
// ============================================
async function seedMaya() {
  const T = 'maya-consultant';
  const H = h(T);
  console.log('\n🇨🇦 Seeding Maya — IT Consultant, Toronto...');

  // 1. Tenant config
  await put(`${CORE}/api/v1/agentbook-core/tenant-config`, H, {
    businessType: 'freelancer',
    jurisdiction: 'ca',
    region: 'ON',
    currency: 'CAD',
    locale: 'en-CA',
    timezone: 'America/Toronto',
    fiscalYearStart: 1,
  });

  // 2. Seed accounts (jurisdiction-aware)
  await get(`${CORE}/api/v1/agentbook-core/tenant-config`, H); // ensure config exists
  await post(`${CORE}/api/v1/agentbook-core/accounts/seed-jurisdiction`, H, {});
  console.log('  ✓ Tenant config + chart of accounts');

  // 3. Clients
  const techcorp = (await post(`${INVOICE}/api/v1/agentbook-invoice/clients`, H, {
    name: 'TechCorp Solutions', email: 'ap@techcorp.ca', address: '100 King St W, Toronto ON M5X 1A9', defaultTerms: 'net-30',
  })).data;

  const widgetco = (await post(`${INVOICE}/api/v1/agentbook-invoice/clients`, H, {
    name: 'WidgetCo Inc', email: 'billing@widgetco.ca', address: '200 Bay St, Toronto ON M5J 2J5', defaultTerms: 'net-15',
  })).data;

  const startupxyz = (await post(`${INVOICE}/api/v1/agentbook-invoice/clients`, H, {
    name: 'StartupXYZ', email: 'founder@startupxyz.io', address: '50 Wellington St E, Toronto ON M5E 1C8', defaultTerms: 'net-30',
  })).data;
  console.log('  ✓ 3 clients: TechCorp, WidgetCo, StartupXYZ');

  // 4. Invoices (Jan–Mar 2026)
  const months = [
    { month: '01', techcorp: 1200000, widgetco: 500000, startup: 300000 },
    { month: '02', techcorp: 1200000, widgetco: 500000, startup: 450000 },
    { month: '03', techcorp: 1200000, widgetco: 500000, startup: 300000 },
  ];

  for (const m of months) {
    // TechCorp — $12,000/mo retainer
    await post(`${INVOICE}/api/v1/agentbook-invoice/invoices`, H, {
      clientId: techcorp.id, currency: 'CAD',
      issuedDate: `2026-${m.month}-01`, dueDate: `2026-${m.month}-28`,
      lines: [
        { description: 'Cloud architecture consulting — retainer', quantity: 80, rateCents: 15000 },
      ],
    });

    // WidgetCo — $5,000/mo
    await post(`${INVOICE}/api/v1/agentbook-invoice/invoices`, H, {
      clientId: widgetco.id, currency: 'CAD',
      issuedDate: `2026-${m.month}-01`, dueDate: `2026-${m.month}-15`,
      lines: [
        { description: 'API integration development', quantity: 40, rateCents: 12500 },
      ],
    });

    // StartupXYZ — variable
    await post(`${INVOICE}/api/v1/agentbook-invoice/invoices`, H, {
      clientId: startupxyz.id, currency: 'CAD',
      issuedDate: `2026-${m.month}-05`, dueDate: `2026-${m.month}-28`,
      lines: [
        { description: 'Technical advisory — ad hoc', quantity: 1, rateCents: m.startup },
      ],
    });
  }
  console.log('  ✓ 9 invoices (3 months × 3 clients)');

  // 5. Record payments (TechCorp always on time, WidgetCo sometimes late, Startup spotty)
  const invoices = (await get(`${INVOICE}/api/v1/agentbook-invoice/invoices`, H)).data;
  for (const inv of invoices) {
    if (inv.status === 'void' || inv.status === 'paid') continue;
    const clientName = inv.clientId === techcorp.id ? 'TechCorp' : inv.clientId === widgetco.id ? 'WidgetCo' : 'StartupXYZ';

    // TechCorp: paid all, WidgetCo: paid Jan+Feb, StartupXYZ: paid Jan only
    const shouldPay =
      clientName === 'TechCorp' ||
      (clientName === 'WidgetCo' && (inv.number.includes('-0004') || inv.number.includes('-0005') || inv.number.includes('-0007') || inv.number.includes('-0008'))) ||
      (clientName === 'StartupXYZ' && inv.number.includes('-0003'));

    if (shouldPay) {
      await post(`${INVOICE}/api/v1/agentbook-invoice/payments`, H, {
        invoiceId: inv.id, amountCents: inv.amountCents, method: 'bank_transfer',
        date: new Date(new Date(inv.dueDate).getTime() + (clientName === 'WidgetCo' ? 5 * 86400000 : 0)).toISOString(),
      });
    } else {
      // Mark as sent (overdue)
      await post(`${INVOICE}/invoices/${inv.id}/send`, H, {});
    }
  }
  console.log('  ✓ Payments recorded (TechCorp: all paid, WidgetCo: 2/3, StartupXYZ: 1/3)');

  // 6. Expenses (realistic monthly expenses)
  const expenseData = [
    // Monthly recurring
    { amountCents: 7900, vendor: 'Shopify', date: '2026-01-15', description: 'E-commerce tools subscription' },
    { amountCents: 7900, vendor: 'Shopify', date: '2026-02-15', description: 'E-commerce tools subscription' },
    { amountCents: 7900, vendor: 'Shopify', date: '2026-03-15', description: 'E-commerce tools subscription' },
    { amountCents: 5499, vendor: 'Adobe', date: '2026-01-20', description: 'Adobe Creative Cloud' },
    { amountCents: 5499, vendor: 'Adobe', date: '2026-02-20', description: 'Adobe Creative Cloud' },
    { amountCents: 5499, vendor: 'Adobe', date: '2026-03-20', description: 'Adobe Creative Cloud' },
    { amountCents: 2999, vendor: 'GitHub', date: '2026-01-01', description: 'GitHub Team' },
    { amountCents: 2999, vendor: 'GitHub', date: '2026-02-01', description: 'GitHub Team' },
    { amountCents: 2999, vendor: 'GitHub', date: '2026-03-01', description: 'GitHub Team' },
    { amountCents: 19900, vendor: 'Notion', date: '2026-01-01', description: 'Notion workspace (annual)' },
    // Office & co-working
    { amountCents: 45000, vendor: 'WeWork', date: '2026-01-01', description: 'Co-working desk January' },
    { amountCents: 45000, vendor: 'WeWork', date: '2026-02-01', description: 'Co-working desk February' },
    { amountCents: 45000, vendor: 'WeWork', date: '2026-03-01', description: 'Co-working desk March' },
    // Travel
    { amountCents: 48500, vendor: 'Air Canada', date: '2026-01-22', description: 'Flight to Montreal for TechCorp onsite' },
    { amountCents: 22000, vendor: 'Marriott', date: '2026-01-22', description: 'Hotel Montreal 2 nights' },
    { amountCents: 6500, vendor: 'Uber', date: '2026-01-22', description: 'Airport taxi Montreal' },
    { amountCents: 35000, vendor: 'WestJet', date: '2026-03-10', description: 'Flight to Vancouver conference' },
    { amountCents: 45000, vendor: 'Hyatt', date: '2026-03-10', description: 'Hotel Vancouver 3 nights' },
    // Meals with clients
    { amountCents: 8500, vendor: 'Canoe Restaurant', date: '2026-01-15', description: 'Lunch with TechCorp PM' },
    { amountCents: 6200, vendor: 'Starbucks', date: '2026-02-03', description: 'Coffee meeting with StartupXYZ' },
    { amountCents: 12500, vendor: 'Alo Restaurant', date: '2026-02-28', description: 'Dinner with WidgetCo CTO' },
    // Equipment
    { amountCents: 349900, vendor: 'Apple', date: '2026-01-10', description: 'MacBook Pro M4 for development' },
    { amountCents: 54900, vendor: 'Apple', date: '2026-01-10', description: 'AirPods Pro' },
    { amountCents: 89900, vendor: 'Dell', date: '2026-02-15', description: 'Ultrawide monitor 34"' },
    // Professional development
    { amountCents: 39900, vendor: 'AWS', date: '2026-02-01', description: 'AWS Solutions Architect certification' },
    { amountCents: 15000, vendor: 'Udemy', date: '2026-01-15', description: 'Kubernetes advanced course' },
    // Insurance & professional
    { amountCents: 125000, vendor: 'Manulife', date: '2026-01-01', description: 'Professional liability insurance (annual)' },
    // Home office
    { amountCents: 150000, vendor: 'Home Office', date: '2026-01-01', description: 'Home office deduction — 15% of rent ($10,000/yr)' },
    // Internet & phone
    { amountCents: 8999, vendor: 'Bell Canada', date: '2026-01-01', description: 'Internet — business portion (50%)' },
    { amountCents: 8999, vendor: 'Bell Canada', date: '2026-02-01', description: 'Internet — business portion (50%)' },
    { amountCents: 8999, vendor: 'Bell Canada', date: '2026-03-01', description: 'Internet — business portion (50%)' },
    // Personal (should be flagged)
    { amountCents: 15000, vendor: 'Costco', date: '2026-02-10', description: 'Personal groceries', isPersonal: true },
    { amountCents: 8500, vendor: 'Netflix', date: '2026-01-15', description: 'Netflix subscription', isPersonal: true },
  ];

  for (const e of expenseData) {
    await post(`${EXPENSE}/api/v1/agentbook-expense/expenses`, H, e);
  }
  console.log(`  ✓ ${expenseData.length} expenses (software, travel, meals, equipment, insurance)`);

  // 7. Projects + time entries
  const techProject = (await post(`${INVOICE}/api/v1/agentbook-invoice/projects`, H, {
    name: `TechCorp Cloud Migration ${TS}`, clientId: techcorp.id, hourlyRateCents: 15000, budgetHours: 960, status: 'active',
  })).data;

  const widgetProject = (await post(`${INVOICE}/api/v1/agentbook-invoice/projects`, H, {
    name: `WidgetCo API v2 ${TS}`, clientId: widgetco.id, hourlyRateCents: 12500, budgetHours: 480, status: 'active',
  })).data;

  // Log some time entries
  const timeEntries = [
    { projectId: techProject.id, clientId: techcorp.id, description: 'Architecture review meeting', minutes: 120, date: '2026-03-25', hourlyRateCents: 15000 },
    { projectId: techProject.id, clientId: techcorp.id, description: 'Terraform module development', minutes: 360, date: '2026-03-26', hourlyRateCents: 15000 },
    { projectId: techProject.id, clientId: techcorp.id, description: 'CI/CD pipeline setup', minutes: 240, date: '2026-03-27', hourlyRateCents: 15000 },
    { projectId: widgetProject.id, clientId: widgetco.id, description: 'API endpoint implementation', minutes: 300, date: '2026-03-25', hourlyRateCents: 12500 },
    { projectId: widgetProject.id, clientId: widgetco.id, description: 'Integration testing', minutes: 180, date: '2026-03-28', hourlyRateCents: 12500 },
  ];
  for (const te of timeEntries) {
    await post(`${INVOICE}/api/v1/agentbook-invoice/time-entries`, H, te);
  }
  console.log('  ✓ 2 projects + 5 time entries (20 unbilled hours)');

  // 8. Recurring invoice
  await post(`${INVOICE}/api/v1/agentbook-invoice/recurring-invoices`, H, {
    clientId: techcorp.id, frequency: 'monthly',
    nextDue: '2026-04-01', currency: 'CAD',
    templateLines: [{ description: 'Cloud architecture consulting — retainer', quantity: 80, rateCents: 15000 }],
    daysToPay: 30, autoSend: true,
  });
  console.log('  ✓ Recurring invoice (TechCorp $12K/mo)');

  // 9. Agent personality
  await put(`${CORE}/api/v1/agentbook-core/personality`, H, {
    agentId: 'bookkeeper', communicationStyle: 'concise', proactiveLevel: 'balanced',
    industryContext: 'IT consultant in Toronto, Canada. Primarily cloud/DevOps consulting.',
    customInstructions: 'Always round up tax estimates. Remind me about RRSP deadlines.',
  });
  await put(`${CORE}/api/v1/agentbook-core/personality`, H, {
    agentId: 'tax-strategist', communicationStyle: 'detailed', proactiveLevel: 'aggressive', riskTolerance: 'conservative',
  });
  console.log('  ✓ Agent personalities configured');

  // 10. Tax estimate
  await get(`${TAX}/agentbook-tax/tax/estimate`, H);
  console.log('  ✓ Tax estimate calculated');

  // 11. Create an automation
  await post(`${CORE}/api/v1/agentbook-core/automations`, H, {
    name: 'Weekly Client Follow-up',
    description: 'Every Monday, check overdue invoices and send reminders',
    trigger: { type: 'schedule', config: { cron: '0 9 * * 1', timezone: 'America/Toronto' } },
    actions: [
      { type: 'send_reminder', config: { tone: 'gentle', limit: 10 } },
      { type: 'notify', config: { message: 'Weekly invoice follow-up completed', channel: 'telegram' } },
    ],
  });
  console.log('  ✓ Automation: Weekly Client Follow-up');

  console.log('  ✅ Maya seeded — Revenue: ~$51K CAD (Q1), 33 expenses, 2 projects');
}

// ============================================
// PERSONA 2: Alex — Design Agency Owner, Austin, TX
// Revenue: ~$300K USD, 5 clients, 2 contractors
// ============================================
async function seedAlex() {
  const T = 'alex-agency';
  const H = h(T);
  console.log('\n🇺🇸 Seeding Alex — Design Agency, Austin TX...');

  // 1. Tenant config
  await put(`${CORE}/api/v1/agentbook-core/tenant-config`, H, {
    businessType: 'agency',
    jurisdiction: 'us',
    region: 'TX',
    currency: 'USD',
    locale: 'en-US',
    timezone: 'America/Chicago',
    fiscalYearStart: 1,
  });
  await get(`${CORE}/api/v1/agentbook-core/tenant-config`, H);
  await post(`${CORE}/api/v1/agentbook-core/accounts/seed-jurisdiction`, H, {});
  console.log('  ✓ Tenant config + chart of accounts (US/TX)');

  // 2. Clients (5 active)
  const clients: any[] = [];
  const clientData = [
    { name: 'Acme Corp', email: 'finance@acme.com', address: '500 Congress Ave, Austin TX 78701', defaultTerms: 'net-30' },
    { name: 'BlueSky Media', email: 'ap@blueskymedia.com', address: '1000 5th Ave, New York NY 10028', defaultTerms: 'net-30' },
    { name: 'GreenLeaf Brands', email: 'accounts@greenleaf.co', address: '200 Peachtree St, Atlanta GA 30303', defaultTerms: 'net-15' },
    { name: 'Stellar Finance', email: 'invoices@stellarfinance.com', address: '300 Market St, San Francisco CA 94105', defaultTerms: 'net-45' },
    { name: 'NovaTech', email: 'billing@novatech.io', address: '400 S Lamar Blvd, Austin TX 78704', defaultTerms: 'net-30' },
  ];
  for (const cd of clientData) {
    const res = await post(`${INVOICE}/api/v1/agentbook-invoice/clients`, H, cd);
    clients.push(res.data);
  }
  console.log('  ✓ 5 clients: Acme, BlueSky, GreenLeaf, Stellar, NovaTech');

  // 3. Projects (each client has a project)
  const projects: any[] = [];
  const projectData = [
    { name: `Acme Brand Refresh ${TS}`, clientId: clients[0].id, hourlyRateCents: 17500, budgetHours: 200, status: 'active' },
    { name: `BlueSky Campaign Q1 ${TS}`, clientId: clients[1].id, hourlyRateCents: 15000, budgetHours: 150, status: 'active' },
    { name: `GreenLeaf Packaging ${TS}`, clientId: clients[2].id, hourlyRateCents: 20000, budgetHours: 80, status: 'active' },
    { name: `Stellar Annual Report ${TS}`, clientId: clients[3].id, hourlyRateCents: 15000, budgetHours: 100, status: 'completed' },
    { name: `NovaTech Website v3 ${TS}`, clientId: clients[4].id, hourlyRateCents: 16000, budgetHours: 300, status: 'active' },
  ];
  for (const pd of projectData) {
    const res = await post(`${INVOICE}/api/v1/agentbook-invoice/projects`, H, pd);
    projects.push(res.data);
  }
  console.log('  ✓ 5 projects with budgets');

  // 4. Invoices — 3 months of billing
  for (const m of ['01', '02', '03']) {
    // Acme: $15K/mo
    await post(`${INVOICE}/api/v1/agentbook-invoice/invoices`, H, {
      clientId: clients[0].id, issuedDate: `2026-${m}-01`, dueDate: `2026-${m}-28`,
      lines: [
        { description: 'Design services — Brand Refresh', quantity: 60, rateCents: 17500 },
        { description: 'Project management', quantity: 20, rateCents: 10000 },
      ],
    });
    // BlueSky: $10K/mo
    await post(`${INVOICE}/api/v1/agentbook-invoice/invoices`, H, {
      clientId: clients[1].id, issuedDate: `2026-${m}-01`, dueDate: `2026-${m}-28`,
      lines: [{ description: 'Campaign creative — Q1', quantity: 1, rateCents: 1000000 }],
    });
    // GreenLeaf: $8K/mo
    await post(`${INVOICE}/api/v1/agentbook-invoice/invoices`, H, {
      clientId: clients[2].id, issuedDate: `2026-${m}-05`, dueDate: `2026-${m}-20`,
      lines: [{ description: 'Packaging design — Phase ' + m, quantity: 40, rateCents: 20000 }],
    });
    // Stellar: $7.5K (only Jan)
    if (m === '01') {
      await post(`${INVOICE}/api/v1/agentbook-invoice/invoices`, H, {
        clientId: clients[3].id, issuedDate: '2026-01-15', dueDate: '2026-03-01',
        lines: [{ description: 'Annual report design — final', quantity: 50, rateCents: 15000 }],
      });
    }
    // NovaTech: $12K/mo
    await post(`${INVOICE}/api/v1/agentbook-invoice/invoices`, H, {
      clientId: clients[4].id, issuedDate: `2026-${m}-01`, dueDate: `2026-${m}-28`,
      lines: [
        { description: 'Website development', quantity: 50, rateCents: 16000 },
        { description: 'UX research', quantity: 25, rateCents: 12000 },
      ],
    });
  }
  console.log('  ✓ 13 invoices across 5 clients (Q1)');

  // 5. Payments — most clients paid Jan+Feb, March outstanding
  const invoices = (await get(`${INVOICE}/api/v1/agentbook-invoice/invoices?limit=50`, H)).data;
  for (const inv of invoices) {
    const isJanOrFeb = inv.number.includes('-0001') || inv.number.includes('-0002') || inv.number.includes('-0003') ||
                        inv.number.includes('-0004') || inv.number.includes('-0005') || inv.number.includes('-0006') ||
                        inv.number.includes('-0007') || inv.number.includes('-0008');
    if (isJanOrFeb) {
      await post(`${INVOICE}/api/v1/agentbook-invoice/payments`, H, {
        invoiceId: inv.id, amountCents: inv.amountCents, method: 'bank_transfer', date: inv.dueDate,
      });
    } else {
      await post(`${INVOICE}/invoices/${inv.id}/send`, H, {});
    }
  }
  console.log('  ✓ Jan+Feb paid, March invoices outstanding');

  // 6. Expenses (agency-scale)
  const expenses = [
    // Office rent
    { amountCents: 350000, vendor: 'Austin Creative Hub', date: '2026-01-01', description: 'Office rent January' },
    { amountCents: 350000, vendor: 'Austin Creative Hub', date: '2026-02-01', description: 'Office rent February' },
    { amountCents: 350000, vendor: 'Austin Creative Hub', date: '2026-03-01', description: 'Office rent March' },
    // Contractor payments (approaching 1099 threshold)
    { amountCents: 250000, vendor: 'Sarah Chen (Contractor)', date: '2026-01-15', description: 'Freelance illustration — Acme project' },
    { amountCents: 250000, vendor: 'Sarah Chen (Contractor)', date: '2026-02-15', description: 'Freelance illustration — BlueSky campaign' },
    { amountCents: 250000, vendor: 'Sarah Chen (Contractor)', date: '2026-03-15', description: 'Freelance illustration — GreenLeaf packaging' },
    { amountCents: 180000, vendor: 'Mike Park (Contractor)', date: '2026-01-20', description: 'Frontend development — NovaTech' },
    { amountCents: 180000, vendor: 'Mike Park (Contractor)', date: '2026-02-20', description: 'Frontend development — NovaTech' },
    { amountCents: 180000, vendor: 'Mike Park (Contractor)', date: '2026-03-20', description: 'Frontend development — NovaTech' },
    // Software subscriptions
    { amountCents: 54900, vendor: 'Figma', date: '2026-01-01', description: 'Figma Organization plan' },
    { amountCents: 54900, vendor: 'Figma', date: '2026-02-01', description: 'Figma Organization plan' },
    { amountCents: 54900, vendor: 'Figma', date: '2026-03-01', description: 'Figma Organization plan' },
    { amountCents: 29900, vendor: 'Adobe', date: '2026-01-01', description: 'Adobe All Apps plan' },
    { amountCents: 29900, vendor: 'Adobe', date: '2026-02-01', description: 'Adobe All Apps plan' },
    { amountCents: 29900, vendor: 'Adobe', date: '2026-03-01', description: 'Adobe All Apps plan' },
    { amountCents: 7900, vendor: 'Slack', date: '2026-01-01', description: 'Slack Pro' },
    { amountCents: 7900, vendor: 'Slack', date: '2026-02-01', description: 'Slack Pro' },
    { amountCents: 7900, vendor: 'Slack', date: '2026-03-01', description: 'Slack Pro' },
    { amountCents: 14900, vendor: 'Asana', date: '2026-01-01', description: 'Asana Business' },
    { amountCents: 14900, vendor: 'Asana', date: '2026-02-01', description: 'Asana Business' },
    { amountCents: 14900, vendor: 'Asana', date: '2026-03-01', description: 'Asana Business' },
    // Client entertainment
    { amountCents: 35000, vendor: 'Uchi Austin', date: '2026-01-25', description: 'Client dinner — Acme Corp stakeholders' },
    { amountCents: 22000, vendor: 'Four Seasons Bar', date: '2026-02-12', description: 'Drinks with BlueSky creative director' },
    // Equipment
    { amountCents: 199900, vendor: 'Apple', date: '2026-01-05', description: 'Mac Studio for design team' },
    { amountCents: 129900, vendor: 'Wacom', date: '2026-01-05', description: 'Wacom Cintiq 27 Pro' },
    // Marketing
    { amountCents: 50000, vendor: 'Google Ads', date: '2026-01-15', description: 'Google Ads — agency awareness' },
    { amountCents: 50000, vendor: 'Google Ads', date: '2026-02-15', description: 'Google Ads — agency awareness' },
    { amountCents: 50000, vendor: 'Google Ads', date: '2026-03-15', description: 'Google Ads — agency awareness' },
    // Insurance
    { amountCents: 200000, vendor: 'Hiscox', date: '2026-01-01', description: 'E&O insurance (annual)' },
  ];

  for (const e of expenses) {
    await post(`${EXPENSE}/api/v1/agentbook-expense/expenses`, H, e);
  }
  console.log(`  ✓ ${expenses.length} expenses (rent, contractors, software, equipment, marketing)`);

  // 7. Time entries (team tracked hours)
  const agencyTimeEntries = [
    { projectId: projects[0].id, clientId: clients[0].id, description: 'Brand strategy workshop', minutes: 240, date: '2026-03-24', hourlyRateCents: 17500 },
    { projectId: projects[0].id, clientId: clients[0].id, description: 'Logo exploration — Round 2', minutes: 360, date: '2026-03-25', hourlyRateCents: 17500 },
    { projectId: projects[1].id, clientId: clients[1].id, description: 'Social media creative batch', minutes: 300, date: '2026-03-25', hourlyRateCents: 15000 },
    { projectId: projects[2].id, clientId: clients[2].id, description: 'Packaging mockup — v3', minutes: 180, date: '2026-03-26', hourlyRateCents: 20000 },
    { projectId: projects[4].id, clientId: clients[4].id, description: 'Homepage wireframe review', minutes: 120, date: '2026-03-27', hourlyRateCents: 16000 },
    { projectId: projects[4].id, clientId: clients[4].id, description: 'Design system components', minutes: 480, date: '2026-03-28', hourlyRateCents: 16000 },
  ];
  for (const te of agencyTimeEntries) {
    await post(`${INVOICE}/api/v1/agentbook-invoice/time-entries`, H, te);
  }
  console.log('  ✓ 6 time entries (28 unbilled hours)');

  // 8. Agent personality
  await put(`${CORE}/api/v1/agentbook-core/personality`, H, {
    agentId: 'bookkeeper', communicationStyle: 'concise', proactiveLevel: 'aggressive',
    industryContext: 'Design agency in Austin TX. 2 contractors, 5 active clients.',
  });
  await put(`${CORE}/api/v1/agentbook-core/personality`, H, {
    agentId: 'collections', communicationStyle: 'detailed', proactiveLevel: 'aggressive', riskTolerance: 'aggressive',
    customInstructions: 'Be assertive on follow-ups. Our clients are large companies who can afford to pay on time.',
  });
  console.log('  ✓ Agent personalities configured');

  await get(`${TAX}/agentbook-tax/tax/estimate`, H);
  console.log('  ✓ Tax estimate calculated');

  console.log('  ✅ Alex seeded — Revenue: ~$130K USD (Q1), 29 expenses, 5 projects, 2 contractors');
}

// ============================================
// PERSONA 3: Jordan — Side-Hustle, Portland OR
// Revenue: ~$35K USD from Etsy + freelance writing
// ============================================
async function seedJordan() {
  const T = 'jordan-sidehustle';
  const H = h(T);
  console.log('\n🇺🇸 Seeding Jordan — Side-Hustle, Portland OR...');

  // 1. Tenant config
  await put(`${CORE}/api/v1/agentbook-core/tenant-config`, H, {
    businessType: 'freelancer',
    jurisdiction: 'us',
    region: 'OR',
    currency: 'USD',
    locale: 'en-US',
    timezone: 'America/Los_Angeles',
    fiscalYearStart: 1,
  });
  await get(`${CORE}/api/v1/agentbook-core/tenant-config`, H);
  await post(`${CORE}/api/v1/agentbook-core/accounts/seed-jurisdiction`, H, {});
  console.log('  ✓ Tenant config + chart of accounts (US/OR)');

  // 2. Clients
  const etsy = (await post(`${INVOICE}/api/v1/agentbook-invoice/clients`, H, {
    name: 'Etsy Marketplace', email: 'payments@etsy.com', defaultTerms: 'net-15',
  })).data;
  const blogclient = (await post(`${INVOICE}/api/v1/agentbook-invoice/clients`, H, {
    name: 'ContentFarm Publishing', email: 'editors@contentfarm.io', address: '99 SE Burnside, Portland OR 97214', defaultTerms: 'net-30',
  })).data;
  console.log('  ✓ 2 clients: Etsy, ContentFarm');

  // 3. Invoices — small, irregular
  const invoiceData = [
    { clientId: etsy.id, date: '2026-01-10', due: '2026-01-25', desc: 'Etsy sales payout — January', amt: 185000 },
    { clientId: etsy.id, date: '2026-02-10', due: '2026-02-25', desc: 'Etsy sales payout — February', amt: 210000 },
    { clientId: etsy.id, date: '2026-03-10', due: '2026-03-25', desc: 'Etsy sales payout — March', amt: 175000 },
    { clientId: blogclient.id, date: '2026-01-15', due: '2026-02-15', desc: '5 blog posts @ $200/each', amt: 100000 },
    { clientId: blogclient.id, date: '2026-02-15', due: '2026-03-15', desc: '4 blog posts @ $200/each', amt: 80000 },
    { clientId: blogclient.id, date: '2026-03-15', due: '2026-04-15', desc: '6 blog posts @ $200/each', amt: 120000 },
  ];

  for (const inv of invoiceData) {
    await post(`${INVOICE}/api/v1/agentbook-invoice/invoices`, H, {
      clientId: inv.clientId, issuedDate: inv.date, dueDate: inv.due,
      lines: [{ description: inv.desc, quantity: 1, rateCents: inv.amt }],
    });
  }
  console.log('  ✓ 6 invoices (Etsy payouts + writing gigs)');

  // 4. Payments — Etsy always auto-pays, ContentFarm slow
  const invoices = (await get(`${INVOICE}/api/v1/agentbook-invoice/invoices?limit=20`, H)).data;
  for (const inv of invoices) {
    const isEtsy = inv.clientId === etsy.id;
    const isPastDue = new Date(inv.dueDate) < new Date();
    if (isEtsy || (inv.clientId === blogclient.id && inv.number.includes('-0004'))) {
      await post(`${INVOICE}/api/v1/agentbook-invoice/payments`, H, {
        invoiceId: inv.id, amountCents: inv.amountCents, method: isEtsy ? 'stripe' : 'bank_transfer', date: inv.dueDate,
      });
    } else if (isPastDue) {
      await post(`${INVOICE}/invoices/${inv.id}/send`, H, {});
    }
  }
  console.log('  ✓ Etsy paid, ContentFarm Feb+Mar outstanding');

  // 5. Expenses — mix of business and personal (common pain point for side-hustlers)
  const expenses = [
    // Etsy business expenses
    { amountCents: 3500, vendor: 'Etsy', date: '2026-01-10', description: 'Etsy listing fees — January' },
    { amountCents: 4200, vendor: 'Etsy', date: '2026-02-10', description: 'Etsy listing fees — February' },
    { amountCents: 3100, vendor: 'Etsy', date: '2026-03-10', description: 'Etsy listing fees — March' },
    { amountCents: 8500, vendor: 'USPS', date: '2026-01-12', description: 'Shipping supplies — bubble mailers, boxes' },
    { amountCents: 7200, vendor: 'USPS', date: '2026-02-12', description: 'Shipping supplies' },
    { amountCents: 9500, vendor: 'USPS', date: '2026-03-12', description: 'Shipping supplies' },
    // Craft supplies (COGS)
    { amountCents: 15000, vendor: 'Michaels', date: '2026-01-05', description: 'Candle-making supplies' },
    { amountCents: 12000, vendor: 'Michaels', date: '2026-02-05', description: 'Candle wax + wicks' },
    { amountCents: 18000, vendor: 'Michaels', date: '2026-03-05', description: 'Spring collection supplies' },
    // Writing tools
    { amountCents: 1499, vendor: 'Grammarly', date: '2026-01-01', description: 'Grammarly Premium' },
    { amountCents: 1499, vendor: 'Grammarly', date: '2026-02-01', description: 'Grammarly Premium' },
    { amountCents: 1499, vendor: 'Grammarly', date: '2026-03-01', description: 'Grammarly Premium' },
    { amountCents: 2000, vendor: 'WordPress', date: '2026-01-01', description: 'WordPress hosting (annual /12)' },
    // Home office (small — shared apartment)
    { amountCents: 15000, vendor: 'Home Office', date: '2026-01-01', description: 'Home office — 10% of rent' },
    { amountCents: 15000, vendor: 'Home Office', date: '2026-02-01', description: 'Home office — 10% of rent' },
    { amountCents: 15000, vendor: 'Home Office', date: '2026-03-01', description: 'Home office — 10% of rent' },
    // Internet (30% business)
    { amountCents: 2400, vendor: 'Comcast', date: '2026-01-01', description: 'Internet — 30% business use' },
    { amountCents: 2400, vendor: 'Comcast', date: '2026-02-01', description: 'Internet — 30% business use' },
    { amountCents: 2400, vendor: 'Comcast', date: '2026-03-01', description: 'Internet — 30% business use' },
    // Photography (product photos)
    { amountCents: 25000, vendor: 'Amazon', date: '2026-01-15', description: 'Ring light + photo backdrop for product shots' },
    // Mixed personal/business (this is where Jordan struggles)
    { amountCents: 8500, vendor: 'Costco', date: '2026-01-20', description: 'Costco — office supplies + groceries', isPersonal: false },
    { amountCents: 4500, vendor: 'Target', date: '2026-02-05', description: 'Packing tape + personal items', isPersonal: false },
    { amountCents: 12000, vendor: 'Amazon', date: '2026-02-20', description: 'Shipping scale + personal books', isPersonal: false },
    // Clearly personal
    { amountCents: 1599, vendor: 'Spotify', date: '2026-01-01', description: 'Spotify Premium', isPersonal: true },
    { amountCents: 1599, vendor: 'Spotify', date: '2026-02-01', description: 'Spotify Premium', isPersonal: true },
    { amountCents: 1599, vendor: 'Spotify', date: '2026-03-01', description: 'Spotify Premium', isPersonal: true },
    { amountCents: 7500, vendor: 'Trader Joes', date: '2026-01-25', description: 'Groceries', isPersonal: true },
    { amountCents: 6800, vendor: 'Trader Joes', date: '2026-02-25', description: 'Groceries', isPersonal: true },
  ];

  for (const e of expenses) {
    await post(`${EXPENSE}/api/v1/agentbook-expense/expenses`, H, e);
  }
  console.log(`  ✓ ${expenses.length} expenses (business + personal mixed — Jordan's pain point)`);

  // 6. Split the mixed Costco expense to demonstrate feature
  const allExpenses = (await get(`${EXPENSE}/api/v1/agentbook-expense/expenses`, H)).data;
  const costcoExpense = allExpenses.find((e: any) => e.description?.includes('Costco'));
  if (costcoExpense) {
    await post(`${EXPENSE}/api/v1/agentbook-expense/expenses/${costcoExpense.id}/split`, H, {
      splits: [
        { amountCents: 5000, isPersonal: false, description: 'Office supplies' },
        { amountCents: 3500, isPersonal: true, description: 'Personal groceries' },
      ],
    });
    console.log('  ✓ Split Costco expense: $50 business / $35 personal');
  }

  // 7. Agent personality (casual, minimal notifications)
  await put(`${CORE}/api/v1/agentbook-core/personality`, H, {
    agentId: 'bookkeeper', communicationStyle: 'concise', proactiveLevel: 'minimal',
    industryContext: 'Side-hustle: Etsy candle shop + freelance writing. W-2 day job as software engineer.',
    customInstructions: 'I have a day job — only bug me about things that save money or are time-sensitive.',
  });
  await put(`${CORE}/api/v1/agentbook-core/personality`, H, {
    agentId: 'tax-strategist', proactiveLevel: 'aggressive', riskTolerance: 'conservative',
    customInstructions: 'I file Schedule C alongside my W-2. Help me maximize deductions.',
  });
  console.log('  ✓ Agent personalities configured (minimal notifications, aggressive on taxes)');

  await get(`${TAX}/agentbook-tax/tax/estimate`, H);
  console.log('  ✓ Tax estimate calculated');

  console.log('  ✅ Jordan seeded — Revenue: ~$8.7K USD (Q1), 28 expenses, split transactions demo');
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  AgentBook Persona Seed Script                  ║');
  console.log('║  Creating 3 walkthrough-ready test personas     ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  1. Maya  — 🇨🇦 IT Consultant, Toronto         ║');
  console.log('║  2. Alex  — 🇺🇸 Design Agency, Austin TX       ║');
  console.log('║  3. Jordan — 🇺🇸 Side-Hustle, Portland OR      ║');
  console.log('╚══════════════════════════════════════════════════╝');

  try {
    await seedMaya();
    await seedAlex();
    await seedJordan();

    console.log('\n══════════════════════════════════════════════════');
    console.log('ALL PERSONAS SEEDED SUCCESSFULLY');
    console.log('══════════════════════════════════════════════════');
    console.log('\nTo test, use these tenant IDs as x-tenant-id header:');
    console.log('  maya-consultant    — Full-time IT consultant (CA, $180K)');
    console.log('  alex-agency        — Design agency owner (US, $300K)');
    console.log('  jordan-sidehustle  — Side-hustle seller+writer (US, $35K)');
    console.log('\nExample API calls:');
    console.log('  curl http://localhost:4050/api/v1/agentbook-core/ask -H "x-tenant-id: maya-consultant" -H "Content-Type: application/json" -d \'{"question":"What is my tax situation?"}\'');
    console.log('  curl http://localhost:4050/api/v1/agentbook-core/simulate -H "x-tenant-id: alex-agency" -H "Content-Type: application/json" -d \'{"scenario":"What if I lose Acme Corp as a client?"}\'');
    console.log('  curl http://localhost:4050/api/v1/agentbook-core/money-moves -H "x-tenant-id: jordan-sidehustle"');
    console.log('');
  } catch (err) {
    console.error('\n❌ Seed failed:', err);
    process.exit(1);
  }
}

main();
