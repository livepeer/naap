import { describe, it, expect } from 'vitest';
import {
  ExecSchema, ExecAsyncSchema, ExecScriptSchema, UploadSchema,
  validateCommand, validateRemotePath, validateScript,
} from '../lib/validator.js';

describe('ExecSchema', () => {
  it('accepts valid input', () => {
    const result = ExecSchema.parse({
      host: '10.0.1.5', port: 22, username: 'deploy',
      command: 'ls -la', timeout: 5000,
    });
    expect(result.host).toBe('10.0.1.5');
    expect(result.command).toBe('ls -la');
  });

  it('applies defaults', () => {
    const result = ExecSchema.parse({
      host: '10.0.1.5', username: 'deploy', command: 'whoami',
    });
    expect(result.port).toBe(22);
    expect(result.timeout).toBe(30000);
    expect(result.env).toEqual({});
  });

  it('rejects empty command', () => {
    expect(() => ExecSchema.parse({
      host: '10.0.1.5', username: 'deploy', command: '',
    })).toThrow();
  });

  it('rejects timeout > 300s', () => {
    expect(() => ExecSchema.parse({
      host: '10.0.1.5', username: 'deploy', command: 'ls',
      timeout: 400000,
    })).toThrow();
  });
});

describe('ExecAsyncSchema', () => {
  it('allows timeout up to 1 hour', () => {
    const result = ExecAsyncSchema.parse({
      host: '10.0.1.5', username: 'deploy', command: 'docker pull x',
      timeout: 3600000,
    });
    expect(result.timeout).toBe(3600000);
  });
});

describe('ExecScriptSchema', () => {
  it('accepts valid script', () => {
    const result = ExecScriptSchema.parse({
      host: '10.0.1.5', username: 'deploy',
      script: '#!/bin/bash\necho hello',
      workingDirectory: '/opt/app',
    });
    expect(result.script).toContain('echo hello');
    expect(result.workingDirectory).toBe('/opt/app');
  });

  it('rejects oversized script', () => {
    const script = 'x'.repeat(70000);
    expect(() => ExecScriptSchema.parse({
      host: '10.0.1.5', username: 'deploy', script,
    })).toThrow();
  });
});

describe('UploadSchema', () => {
  it('accepts valid upload', () => {
    const result = UploadSchema.parse({
      host: '10.0.1.5', username: 'deploy',
      remotePath: '/opt/app/file.txt',
      content: Buffer.from('hello').toString('base64'),
    });
    expect(result.mode).toBe('0644');
  });

  it('validates mode format', () => {
    expect(() => UploadSchema.parse({
      host: '10.0.1.5', username: 'deploy',
      remotePath: '/opt/file', content: 'abc', mode: '999',
    })).toThrow();
  });
});

describe('validateCommand', () => {
  it('allows safe commands', () => {
    expect(() => validateCommand('ls -la /opt')).not.toThrow();
    expect(() => validateCommand('docker run -d myapp')).not.toThrow();
    expect(() => validateCommand('systemctl restart nginx')).not.toThrow();
  });

  it('blocks rm -rf /', () => {
    expect(() => validateCommand('rm -rf /')).toThrow(/blocklist/);
  });

  it('blocks mkfs', () => {
    expect(() => validateCommand('mkfs.ext4 /dev/sda1')).toThrow(/blocklist/);
  });

  it('blocks fork bombs', () => {
    expect(() => validateCommand(':(){ :|:& };:')).toThrow(/blocklist/);
  });

  it('allows rm -rf on specific paths', () => {
    expect(() => validateCommand('rm -rf /opt/app/old')).not.toThrow();
  });
});

describe('validateRemotePath', () => {
  it('allows normal paths', () => {
    expect(() => validateRemotePath('/opt/app/file.txt')).not.toThrow();
    expect(() => validateRemotePath('/home/deploy/.config')).not.toThrow();
  });

  it('blocks path traversal', () => {
    expect(() => validateRemotePath('/opt/app/../../etc/passwd')).toThrow(/traversal/);
    expect(() => validateRemotePath('/opt/app/..')).toThrow(/traversal/);
  });
});

describe('validateScript', () => {
  it('allows normal scripts', () => {
    expect(() => validateScript('#!/bin/bash\necho hello\n')).not.toThrow();
  });

  it('blocks binary content', () => {
    expect(() => validateScript('binary\x00content')).toThrow(/binary/);
  });

  it('blocks oversized scripts', () => {
    expect(() => validateScript('x'.repeat(70000))).toThrow(/maximum size/);
  });
});
