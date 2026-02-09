/**
 * Plugin Specification Parser
 * Parses plugin.md markdown files into structured PluginSpec objects.
 */

import type {
  PluginSpec,
  UserStory,
  AcceptanceCriterion,
  DataModel,
  DataModelField,
  Permission,
  Integration,
  PluginSetting,
} from './types.js';

/**
 * Parse errors for better debugging
 */
export class SpecParseError extends Error {
  constructor(
    message: string,
    public section: string,
    public line?: number,
  ) {
    super(`[${section}]${line ? ` Line ${line}:` : ''} ${message}`);
    this.name = 'SpecParseError';
  }
}

/**
 * SpecParser - Parses plugin.md specifications into PluginSpec objects
 */
export class SpecParser {
  /**
   * Parse a plugin.md markdown string into a PluginSpec
   */
  parse(markdown: string): PluginSpec {
    const sections = this.extractSections(markdown);

    const name = this.extractPluginName(sections, markdown);
    const displayName = this.extractDisplayName(sections, markdown);
    const description = this.extractDescription(sections);

    return {
      name: this.slugify(name),
      displayName,
      description,
      version: this.extractVersion(sections) || '1.0.0',
      category: this.extractCategory(sections),
      userStories: this.parseUserStories(sections['User Stories'] || sections['user stories'] || ''),
      dataModel: this.parseDataModel(sections['Data Model'] || sections['data model'] || ''),
      permissions: this.parsePermissions(sections['Permissions'] || sections['permissions'] || ''),
      integrations: this.parseIntegrations(sections['Integrations'] || sections['integrations'] || ''),
      settings: this.parseSettings(sections['Settings'] || sections['settings'] || ''),
      rawMarkdown: markdown,
    };
  }

  /**
   * Validate a PluginSpec for completeness
   */
  validate(spec: PluginSpec): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!spec.name) errors.push('Plugin name is required');
    if (!spec.displayName) errors.push('Display name is required');
    if (!spec.description) errors.push('Description is required');

    // User stories validation
    if (spec.userStories.length === 0) {
      warnings.push('No user stories defined - consider adding at least one');
    }

    for (const story of spec.userStories) {
      if (!story.id) errors.push(`User story missing ID: "${story.title}"`);
      if (story.acceptanceCriteria.length === 0) {
        warnings.push(`User story ${story.id} has no acceptance criteria`);
      }
    }

    // Data model validation
    for (const model of spec.dataModel) {
      if (!model.name) errors.push('Data model missing name');
      if (model.fields.length === 0) {
        warnings.push(`Data model ${model.name} has no fields defined`);
      }
    }

    // Permission validation
    if (spec.permissions.length === 0) {
      warnings.push('No permissions defined - all users will have full access');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Extract sections from markdown based on headers
   */
  private extractSections(markdown: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const lines = markdown.split('\n');

    let currentSection = '';
    let currentContent: string[] = [];

    for (const line of lines) {
      // Match ## or ### headers
      const headerMatch = line.match(/^#{2,3}\s+(.+)$/);

      if (headerMatch) {
        // Save previous section
        if (currentSection) {
          sections[currentSection] = currentContent.join('\n').trim();
        }

        currentSection = headerMatch[1].trim();
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    // Save last section
    if (currentSection) {
      sections[currentSection] = currentContent.join('\n').trim();
    }

    return sections;
  }

  /**
   * Extract plugin name from header or sections
   */
  private extractPluginName(sections: Record<string, string>, markdown: string): string {
    // Try to find "Plugin: Name" pattern
    const pluginMatch = markdown.match(/##?\s+Plugin:\s*(.+)/i);
    if (pluginMatch) {
      return pluginMatch[1].trim();
    }

    // Try first H1 header
    const h1Match = markdown.match(/^#\s+(.+)/m);
    if (h1Match) {
      return h1Match[1].trim();
    }

    // Fallback to Description section name
    if (sections['Description']) {
      const firstLine = sections['Description'].split('\n')[0];
      return firstLine.trim();
    }

    throw new SpecParseError('Could not determine plugin name', 'Header');
  }

  /**
   * Extract display name (human-readable)
   */
  private extractDisplayName(sections: Record<string, string>, markdown: string): string {
    // Try to find explicit display name
    const displayMatch = markdown.match(/Display\s*Name:\s*(.+)/i);
    if (displayMatch) {
      return displayMatch[1].trim();
    }

    // Use plugin name
    return this.extractPluginName(sections, markdown);
  }

  /**
   * Extract description from Description section
   */
  private extractDescription(sections: Record<string, string>): string {
    const descSection = sections['Description'] || sections['description'] || '';
    if (descSection) {
      // Get first paragraph
      const paragraphs = descSection.split(/\n\n+/);
      return paragraphs[0]?.trim() || '';
    }
    return '';
  }

  /**
   * Extract version if specified
   */
  private extractVersion(sections: Record<string, string>): string | undefined {
    for (const content of Object.values(sections)) {
      const versionMatch = content.match(/Version:\s*([\d.]+)/i);
      if (versionMatch) {
        return versionMatch[1];
      }
    }
    return undefined;
  }

  /**
   * Extract category if specified
   */
  private extractCategory(sections: Record<string, string>): string | undefined {
    for (const content of Object.values(sections)) {
      const categoryMatch = content.match(/Category:\s*(.+)/i);
      if (categoryMatch) {
        return categoryMatch[1].trim().toLowerCase();
      }
    }
    return undefined;
  }

  /**
   * Parse user stories section
   */
  private parseUserStories(section: string): UserStory[] {
    if (!section.trim()) return [];

    const stories: UserStory[] = [];
    // Match user story blocks: #### US-X: Title
    const storyRegex = /####\s+(US-\d+):\s*(.+?)(?=####|$)/gs;

    let match;
    while ((match = storyRegex.exec(section)) !== null) {
      const [, id, rest] = match;
      const content = rest.trim();

      // Parse "As a... I want... So that..." format
      const asAMatch = content.match(/As\s+a[n]?\s+(.+?),/i);
      const iWantMatch = content.match(/I\s+want\s+(?:to\s+)?(.+?),/i);
      const soThatMatch = content.match(/so\s+that\s+(.+?)(?:\.|$)/i);

      // Parse acceptance criteria (checkboxes)
      const criteriaMatches = content.match(/\[[ x]\]\s+(.+)/g) || [];
      const acceptanceCriteria: AcceptanceCriterion[] = criteriaMatches.map(c => {
        const completed = c.startsWith('[x]') || c.startsWith('[X]');
        const description = c.replace(/\[[ xX]\]\s+/, '').trim();
        return { description, completed };
      });

      // Extract title from first line if not in format
      const lines = content.split('\n');
      const title = lines[0].replace(/As\s+a.*$/i, '').trim() || id;

      stories.push({
        id,
        title: title || this.extractTitleFromStory(content),
        asA: asAMatch?.[1]?.trim() || 'user',
        iWant: iWantMatch?.[1]?.trim() || this.extractActionFromStory(content),
        soThat: soThatMatch?.[1]?.trim() || 'I can achieve my goal',
        acceptanceCriteria,
      });
    }

    return stories;
  }

  /**
   * Extract title from user story content if not explicit
   */
  private extractTitleFromStory(content: string): string {
    // First non-empty line that's not the "As a..." pattern
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.match(/^As\s+a/i) && !trimmed.match(/^\[[ xX]\]/)) {
        return trimmed.substring(0, 50);
      }
    }
    return 'Untitled Story';
  }

  /**
   * Extract action from user story if "I want" pattern not found
   */
  private extractActionFromStory(content: string): string {
    // Try to find action from context
    const actionMatch = content.match(/(?:want|need|should|can)\s+(?:to\s+)?(.+?)(?:\.|,|$)/i);
    if (actionMatch) {
      return actionMatch[1].trim();
    }
    return 'perform an action';
  }

  /**
   * Parse data model section
   */
  private parseDataModel(section: string): DataModel[] {
    if (!section.trim()) return [];

    const models: DataModel[] = [];

    // Find code blocks with model definitions
    const codeBlockRegex = /```(?:prisma|typescript|ts)?\n([\s\S]*?)```/g;
    let codeMatch;

    while ((codeMatch = codeBlockRegex.exec(section)) !== null) {
      const code = codeMatch[1];
      const modelMatches = code.matchAll(/(\w+)\s*\{([^}]+)\}/g);

      for (const modelMatch of modelMatches) {
        const [, name, fieldsBlock] = modelMatch;
        const fields = this.parseModelFields(fieldsBlock);

        models.push({
          name,
          fields,
        });
      }
    }

    // Also try plain text format
    // ModelName {
    //   field: Type
    // }
    if (models.length === 0) {
      const plainModelRegex = /(\w+)\s*\{([^}]+)\}/g;
      let plainMatch;

      while ((plainMatch = plainModelRegex.exec(section)) !== null) {
        const [, name, fieldsBlock] = plainMatch;
        const fields = this.parseModelFields(fieldsBlock);

        if (fields.length > 0) {
          models.push({ name, fields });
        }
      }
    }

    return models;
  }

  /**
   * Parse model fields from a fields block
   */
  private parseModelFields(fieldsBlock: string): DataModelField[] {
    const fields: DataModelField[] = [];
    const lines = fieldsBlock.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Match: fieldName: Type or fieldName: Type? or fieldName: Type (description)
      const fieldMatch = trimmed.match(/^(\w+):\s*(\w+)(\?)?\s*(?:\((.+)\))?/);

      if (fieldMatch) {
        const [, name, type, optional, description] = fieldMatch;

        // Check for enum values
        const enumMatch = type.match(/Enum\s*\(([^)]+)\)/i);
        let enumValues: string[] | undefined;
        let fieldType = type;

        if (enumMatch) {
          enumValues = enumMatch[1].split(',').map(v => v.trim());
          fieldType = 'Enum';
        }

        fields.push({
          name,
          type: fieldType,
          optional: !!optional,
          enumValues,
          description,
        });
      }
    }

    return fields;
  }

  /**
   * Parse permissions section
   */
  private parsePermissions(section: string): Permission[] {
    if (!section.trim()) return [];

    const permissions: Permission[] = [];
    const lines = section.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('-')) continue;

      // Match: - role - action1, action2, action3
      // Or: - role: action1, action2
      const permMatch = trimmed.match(/^-\s*(\S+)\s*[-:]\s*(.+)/);

      if (permMatch) {
        const [, role, actionsStr] = permMatch;
        const actions = actionsStr.split(/[,;]/).map(a => a.trim().toLowerCase());

        permissions.push({
          role: role.trim(),
          actions: actions.filter(a => a.length > 0),
        });
      }
    }

    return permissions;
  }

  /**
   * Parse integrations section
   */
  private parseIntegrations(section: string): Integration[] {
    if (!section.trim()) return [];

    const integrations: Integration[] = [];
    const lines = section.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('-')) continue;

      // Match: - Name: Description (required|optional)
      const integMatch = trimmed.match(/^-\s*(\w+):\s*(.+?)(?:\s*\((required|optional)\))?$/i);

      if (integMatch) {
        const [, name, description, requiredStr] = integMatch;

        integrations.push({
          name: name.toLowerCase(),
          type: this.inferIntegrationType(name),
          description: description.trim(),
          required: requiredStr?.toLowerCase() === 'required',
        });
      }
    }

    return integrations;
  }

  /**
   * Infer integration type from name
   */
  private inferIntegrationType(name: string): string {
    const nameLower = name.toLowerCase();

    if (['storage', 'blob', 's3', 'file'].some(t => nameLower.includes(t))) {
      return 'Storage';
    }
    if (['ai', 'ml', 'llm', 'ocr'].some(t => nameLower.includes(t))) {
      return 'AI';
    }
    if (['email', 'notification', 'sms', 'push'].some(t => nameLower.includes(t))) {
      return 'Notification';
    }
    if (['database', 'db', 'sql'].some(t => nameLower.includes(t))) {
      return 'Database';
    }
    if (['auth', 'oauth', 'sso'].some(t => nameLower.includes(t))) {
      return 'Authentication';
    }
    if (['payment', 'stripe', 'billing'].some(t => nameLower.includes(t))) {
      return 'Payment';
    }

    return 'Custom';
  }

  /**
   * Parse settings section
   */
  private parseSettings(section: string): PluginSetting[] {
    if (!section.trim()) return [];

    const settings: PluginSetting[] = [];
    const lines = section.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('-')) continue;

      // Match: - settingName: Type (description)
      // Or: - settingName: Type = defaultValue (description)
      const settingMatch = trimmed.match(/^-\s*(\w+):\s*(\w+)(?:\[\])?\s*(?:=\s*([^\(]+))?\s*(?:\((.+)\))?$/);

      if (settingMatch) {
        const [, name, typeStr, defaultValue, description] = settingMatch;
        const isArray = trimmed.includes('[]');

        settings.push({
          name,
          type: this.parseSettingType(typeStr, isArray),
          required: !defaultValue,
          default: this.parseDefaultValue(defaultValue, typeStr),
          description: description?.trim(),
        });
      }
    }

    return settings;
  }

  /**
   * Parse setting type from string
   */
  private parseSettingType(typeStr: string, isArray: boolean): PluginSetting['type'] {
    const typeLower = typeStr.toLowerCase();

    if (isArray) return 'array';
    if (typeLower === 'number' || typeLower === 'int' || typeLower === 'float') return 'number';
    if (typeLower === 'boolean' || typeLower === 'bool') return 'boolean';
    if (typeLower === 'object' || typeLower === 'json') return 'object';

    return 'string';
  }

  /**
   * Parse default value with type inference
   */
  private parseDefaultValue(value: string | undefined, typeStr: string): unknown {
    if (!value) return undefined;

    const trimmed = value.trim();
    const typeLower = typeStr.toLowerCase();

    if (typeLower === 'number' || typeLower === 'int' || typeLower === 'float') {
      return parseFloat(trimmed);
    }
    if (typeLower === 'boolean' || typeLower === 'bool') {
      return trimmed.toLowerCase() === 'true';
    }
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  /**
   * Convert a name to URL-safe slug
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

/**
 * Create a new SpecParser instance
 */
export function createSpecParser(): SpecParser {
  return new SpecParser();
}
