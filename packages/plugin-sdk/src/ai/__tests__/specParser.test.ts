/**
 * SpecParser Tests
 *
 * Tests for plugin.md specification parsing functionality.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SpecParser, SpecParseError } from '../specParser.js';
import type { PluginSpec } from '../types.js';

describe('SpecParser', () => {
  let parser: SpecParser;

  beforeEach(() => {
    parser = new SpecParser();
  });

  describe('Basic Parsing', () => {
    it('should parse a minimal plugin spec', () => {
      const markdown = `
# Expense Tracker Plugin

## Description
A plugin for tracking team expenses.

## User Stories

#### US-1: Create Expense
As a team member, I want to create expense entries, so that I can track my spending.

- [ ] Can enter amount
- [ ] Can select category
      `;

      const spec = parser.parse(markdown);

      expect(spec.displayName).toBe('Expense Tracker Plugin');
      expect(spec.name).toBe('expense-tracker-plugin');
      expect(spec.description).toBe('A plugin for tracking team expenses.');
      expect(spec.userStories.length).toBe(1);
    });

    it('should parse plugin name from "Plugin:" prefix', () => {
      const markdown = `
## Plugin: My Dashboard

## Description
Dashboard plugin.
      `;

      const spec = parser.parse(markdown);
      expect(spec.displayName).toBe('My Dashboard');
      expect(spec.name).toBe('my-dashboard');
    });

    it('should default version to 1.0.0 when not specified', () => {
      const markdown = `
# Test Plugin

## Description
A test plugin.
      `;

      const spec = parser.parse(markdown);
      expect(spec.version).toBe('1.0.0');
    });

    it('should extract version when specified', () => {
      const markdown = `
# Test Plugin

## Description
A test plugin.
Version: 2.5.0
      `;

      const spec = parser.parse(markdown);
      expect(spec.version).toBe('2.5.0');
    });

    it('should extract category when specified', () => {
      const markdown = `
# Analytics Plugin

## Description
Analytics plugin.
Category: analytics
      `;

      const spec = parser.parse(markdown);
      expect(spec.category).toBe('analytics');
    });
  });

  describe('User Stories Parsing', () => {
    it('should parse multiple user stories', () => {
      const markdown = `
# Test Plugin

## Description
Test plugin.

## User Stories

#### US-1: Create Item
As a user, I want to create items, so that I can track them.

- [ ] Can enter name
- [ ] Can save item

#### US-2: View Items
As a user, I want to view items, so that I can see my data.

- [ ] Shows list of items
- [x] Supports pagination
      `;

      const spec = parser.parse(markdown);

      expect(spec.userStories.length).toBe(2);
      expect(spec.userStories[0].id).toBe('US-1');
      expect(spec.userStories[1].id).toBe('US-2');
    });

    it('should parse user story format correctly', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## User Stories

#### US-1: Submit Expense Report
As a team member, I want to submit expense reports, so that I can get reimbursed.

- [ ] Can attach receipts
- [ ] Can add notes
      `;

      const spec = parser.parse(markdown);
      const story = spec.userStories[0];

      expect(story.id).toBe('US-1');
      expect(story.asA).toBe('team member');
      expect(story.iWant).toBe('submit expense reports');
      expect(story.soThat).toBe('I can get reimbursed');
    });

    it('should parse acceptance criteria', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## User Stories

#### US-1: Create Task
As a user, I want to create tasks, so that I can track work.

- [ ] Can set title
- [x] Can set due date
- [ ] Can assign to team member
      `;

      const spec = parser.parse(markdown);
      const criteria = spec.userStories[0].acceptanceCriteria;

      expect(criteria.length).toBe(3);
      expect(criteria[0].description).toBe('Can set title');
      expect(criteria[0].completed).toBe(false);
      expect(criteria[1].description).toBe('Can set due date');
      expect(criteria[1].completed).toBe(true);
    });

    it('should handle user stories without "As a" format', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## User Stories

#### US-1: Dashboard View
Show a summary dashboard with key metrics.

- [ ] Shows revenue
- [ ] Shows user count
      `;

      const spec = parser.parse(markdown);
      const story = spec.userStories[0];

      expect(story.id).toBe('US-1');
      expect(story.acceptanceCriteria.length).toBe(2);
    });
  });

  describe('Data Model Parsing', () => {
    it('should parse data model from code block', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## Data Model

\`\`\`prisma
Expense {
  id: String
  amount: Decimal
  category: String
  description: String?
}
\`\`\`
      `;

      const spec = parser.parse(markdown);

      expect(spec.dataModel.length).toBe(1);
      expect(spec.dataModel[0].name).toBe('Expense');
      expect(spec.dataModel[0].fields.length).toBe(4);
    });

    it('should parse field types correctly', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## Data Model

\`\`\`typescript
Transaction {
  id: String
  amount: Decimal
  count: Int
  active: Boolean
  timestamp: DateTime
  metadata: Json?
}
\`\`\`
      `;

      const spec = parser.parse(markdown);
      const fields = spec.dataModel[0].fields;

      const fieldTypes = Object.fromEntries(
        fields.map(f => [f.name, f.type])
      );

      expect(fieldTypes.id).toBe('String');
      expect(fieldTypes.amount).toBe('Decimal');
      expect(fieldTypes.count).toBe('Int');
      expect(fieldTypes.active).toBe('Boolean');
      expect(fieldTypes.timestamp).toBe('DateTime');
      expect(fieldTypes.metadata).toBe('Json');
    });

    it('should detect optional fields', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## Data Model

Item {
  id: String
  name: String
  description: String?
  notes: String?
}
      `;

      const spec = parser.parse(markdown);
      const fields = spec.dataModel[0].fields;

      const optional = fields.filter(f => f.optional);
      const required = fields.filter(f => !f.optional);

      expect(optional.length).toBe(2);
      expect(required.length).toBe(2);
    });

    it('should parse multiple models', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## Data Model

\`\`\`prisma
User {
  id: String
  name: String
}

Post {
  id: String
  title: String
  authorId: String
}
\`\`\`
      `;

      const spec = parser.parse(markdown);

      expect(spec.dataModel.length).toBe(2);
      expect(spec.dataModel[0].name).toBe('User');
      expect(spec.dataModel[1].name).toBe('Post');
    });
  });

  describe('Permissions Parsing', () => {
    it('should parse permission definitions', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## Permissions

- team:member - read, create
- team:admin - read, create, update, delete
- team:owner - read, create, update, delete, configure
      `;

      const spec = parser.parse(markdown);

      expect(spec.permissions.length).toBe(3);
      expect(spec.permissions[0].role).toBe('team:member');
      expect(spec.permissions[0].actions).toContain('read');
      expect(spec.permissions[0].actions).toContain('create');
      expect(spec.permissions[1].actions.length).toBe(4);
    });

    it('should handle colon-separated format', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## Permissions

- viewer: read
- editor: read, write
      `;

      const spec = parser.parse(markdown);

      expect(spec.permissions[0].role).toBe('viewer');
      expect(spec.permissions[0].actions).toEqual(['read']);
      expect(spec.permissions[1].actions).toEqual(['read', 'write']);
    });
  });

  describe('Integrations Parsing', () => {
    it('should parse integration definitions', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## Integrations

- Storage: File uploads for receipts (required)
- Email: Send notifications (optional)
- AI: OCR for receipt processing (optional)
      `;

      const spec = parser.parse(markdown);

      expect(spec.integrations.length).toBe(3);
      expect(spec.integrations[0].name).toBe('storage');
      expect(spec.integrations[0].required).toBe(true);
      expect(spec.integrations[1].name).toBe('email');
      expect(spec.integrations[1].required).toBe(false);
    });

    it('should infer integration types', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## Integrations

- Storage: File storage
- AI: Machine learning
- Notification: Email alerts
- Payment: Billing
      `;

      const spec = parser.parse(markdown);

      expect(spec.integrations[0].type).toBe('Storage');
      expect(spec.integrations[1].type).toBe('AI');
      expect(spec.integrations[2].type).toBe('Notification');
      expect(spec.integrations[3].type).toBe('Payment');
    });
  });

  describe('Settings Parsing', () => {
    it('should parse setting definitions', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## Settings

- theme: String = dark (Color theme)
- maxItems: Number = 100 (Maximum items)
- enabled: Boolean = true (Feature flag)
      `;

      const spec = parser.parse(markdown);

      expect(spec.settings.length).toBe(3);
      expect(spec.settings[0].name).toBe('theme');
      expect(spec.settings[0].type).toBe('string');
      expect(spec.settings[0].default).toBe('dark');
      expect(spec.settings[1].name).toBe('maxItems');
      expect(spec.settings[1].type).toBe('number');
      expect(spec.settings[1].default).toBe(100);
    });

    it('should mark settings without defaults as required', () => {
      const markdown = `
# Test Plugin

## Description
Test.

## Settings

- apiKey: String (API key for service)
- optionalValue: String = default
      `;

      const spec = parser.parse(markdown);

      expect(spec.settings[0].required).toBe(true);
      expect(spec.settings[1].required).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should validate required fields', () => {
      const spec: PluginSpec = {
        name: '',
        displayName: '',
        description: '',
        version: '1.0.0',
        userStories: [],
        dataModel: [],
        permissions: [],
        integrations: [],
        settings: [],
        rawMarkdown: '',
      };

      const result = parser.validate(spec);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plugin name is required');
      expect(result.errors).toContain('Display name is required');
      expect(result.errors).toContain('Description is required');
    });

    it('should warn about missing user stories', () => {
      const spec: PluginSpec = {
        name: 'test',
        displayName: 'Test',
        description: 'A test plugin',
        version: '1.0.0',
        userStories: [],
        dataModel: [],
        permissions: [],
        integrations: [],
        settings: [],
        rawMarkdown: '',
      };

      const result = parser.validate(spec);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('No user stories defined - consider adding at least one');
    });

    it('should warn about user stories without acceptance criteria', () => {
      const spec: PluginSpec = {
        name: 'test',
        displayName: 'Test',
        description: 'A test plugin',
        version: '1.0.0',
        userStories: [{
          id: 'US-1',
          title: 'Test Story',
          asA: 'user',
          iWant: 'test',
          soThat: 'testing',
          acceptanceCriteria: [],
        }],
        dataModel: [],
        permissions: [],
        integrations: [],
        settings: [],
        rawMarkdown: '',
      };

      const result = parser.validate(spec);

      expect(result.warnings.some(w => w.includes('US-1') && w.includes('no acceptance criteria'))).toBe(true);
    });

    it('should warn about missing permissions', () => {
      const spec: PluginSpec = {
        name: 'test',
        displayName: 'Test',
        description: 'A test plugin',
        version: '1.0.0',
        userStories: [{
          id: 'US-1',
          title: 'Test',
          asA: 'user',
          iWant: 'test',
          soThat: 'testing',
          acceptanceCriteria: [{ description: 'Works', completed: false }],
        }],
        dataModel: [],
        permissions: [],
        integrations: [],
        settings: [],
        rawMarkdown: '',
      };

      const result = parser.validate(spec);

      expect(result.warnings.some(w => w.includes('permissions'))).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty markdown', () => {
      expect(() => parser.parse('')).toThrow(SpecParseError);
    });

    it('should handle markdown with only headers', () => {
      const markdown = `
# Plugin Name

## Description

## User Stories
      `;

      const spec = parser.parse(markdown);
      expect(spec.displayName).toBe('Plugin Name');
      expect(spec.description).toBe('');
    });

    it('should slugify names correctly', () => {
      const markdown = `
# My Awesome Plugin 2.0!

## Description
Test.
      `;

      const spec = parser.parse(markdown);
      expect(spec.name).toBe('my-awesome-plugin-2-0');
    });

    it('should handle case-insensitive section headers', () => {
      const markdown = `
# Test Plugin

## description
A test plugin.

## user stories

#### US-1: Test
Test story.
      `;

      const spec = parser.parse(markdown);
      expect(spec.description).toBe('A test plugin.');
      expect(spec.userStories.length).toBe(1);
    });
  });
});

describe('SpecParseError', () => {
  it('should include section information', () => {
    const error = new SpecParseError('Test error', 'Header');
    expect(error.message).toContain('[Header]');
    expect(error.section).toBe('Header');
  });

  it('should include line number when provided', () => {
    const error = new SpecParseError('Test error', 'User Stories', 42);
    expect(error.message).toContain('Line 42');
    expect(error.line).toBe(42);
  });
});
