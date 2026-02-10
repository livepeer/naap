#!/usr/bin/env node
/**
 * NAAP Plugin CLI
 * Command-line tool for plugin development lifecycle
 */

import { Command } from 'commander';
import { createCommand } from './commands/create.js';
import { devCommand } from './commands/dev.js';
import { testCommand } from './commands/test.js';
import { createBuildCommand } from './commands/build.js';
import { packageCommand } from './commands/package.js';
import { publishCommand } from './commands/publish.js';
import { versionCommand } from './commands/version.js';
import { deprecateCommand } from './commands/deprecate.js';
import { githubCommand } from './commands/github.js';
import { doctorCommand } from './commands/doctor.js';
import { deployCommand } from './commands/deploy.js';
import { rollbackCommand } from './commands/rollback.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { generateCommand } from './commands/generate.js';
import { iterateCommand } from './commands/iterate.js';

const program = new Command();

program
  .name('naap-plugin')
  .description('CLI for NAAP plugin development')
  .version('0.1.0');

// Register commands
program.addCommand(createCommand);
program.addCommand(devCommand);
program.addCommand(testCommand);
program.addCommand(createBuildCommand());
program.addCommand(packageCommand);
program.addCommand(publishCommand);
program.addCommand(versionCommand);
program.addCommand(deprecateCommand);
program.addCommand(githubCommand);
program.addCommand(doctorCommand);  // Phase 3: Diagnostic command

// Phase 1 Production Deployment Commands
program.addCommand(deployCommand);
program.addCommand(rollbackCommand);
program.addCommand(statusCommand);
program.addCommand(logsCommand);

// Phase 3 AI-Assisted Development Commands
program.addCommand(generateCommand);
program.addCommand(iterateCommand);

program.parse();
