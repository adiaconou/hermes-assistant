/**
 * Unit tests for skills filesystem repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  discoverSkillDirs,
  safeReadFile,
  loadSkillBody,
} from '../../../src/domains/skills/repo/filesystem.js';

describe('discoverSkillDirs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
  });

  it('finds directories containing SKILL.md', () => {
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: x\n---');

    const dirs = discoverSkillDirs(tmpDir);

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(path.resolve(tmpDir, 'my-skill'));
  });

  it('skips directories without SKILL.md', () => {
    const noSkill = path.join(tmpDir, 'no-skill');
    fs.mkdirSync(noSkill);
    fs.writeFileSync(path.join(noSkill, 'README.md'), '# readme');

    const dirs = discoverSkillDirs(tmpDir);

    expect(dirs).toEqual([]);
  });

  it('returns empty array for nonexistent directory', () => {
    const dirs = discoverSkillDirs('/nonexistent/path/xyz');
    expect(dirs).toEqual([]);
  });

  it('skips hidden directories', () => {
    const hiddenDir = path.join(tmpDir, '.hidden-skill');
    fs.mkdirSync(hiddenDir);
    fs.writeFileSync(path.join(hiddenDir, 'SKILL.md'), '---\nname: x\n---');

    const dirs = discoverSkillDirs(tmpDir);

    expect(dirs).toEqual([]);
  });

  it('skips plain files at root level', () => {
    fs.writeFileSync(path.join(tmpDir, 'not-a-dir.md'), 'content');

    const dirs = discoverSkillDirs(tmpDir);

    expect(dirs).toEqual([]);
  });
});

describe('safeReadFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-read-test-'));
  });

  it('reads a file within the skill root', () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello');

    const content = safeReadFile(filePath, tmpDir);

    expect(content).toBe('hello');
  });

  it('blocks path traversal attempts', () => {
    const outsidePath = path.join(tmpDir, '..', 'outside.txt');

    expect(() => safeReadFile(outsidePath, tmpDir)).toThrow('Path traversal');
  });

  it('blocks symlinks', () => {
    const targetPath = path.join(os.tmpdir(), 'symlink-target-' + Date.now() + '.txt');
    fs.writeFileSync(targetPath, 'secret');

    const symlinkPath = path.join(tmpDir, 'link.txt');
    fs.symlinkSync(targetPath, symlinkPath);

    expect(() => safeReadFile(symlinkPath, tmpDir)).toThrow('Symlink not allowed');

    // cleanup
    fs.unlinkSync(targetPath);
  });
});

describe('loadSkillBody', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'body-test-'));
  });

  it('extracts content below frontmatter delimiters', () => {
    const mdPath = path.join(tmpDir, 'SKILL.md');
    fs.writeFileSync(mdPath, `---
name: test
description: Test skill
---
# Skill Body

Instructions here.
`);

    const body = loadSkillBody(mdPath);

    expect(body).toBe('# Skill Body\n\nInstructions here.');
  });

  it('returns full content when no frontmatter', () => {
    const mdPath = path.join(tmpDir, 'SKILL.md');
    fs.writeFileSync(mdPath, '# Just markdown\n\nNo frontmatter here.');

    const body = loadSkillBody(mdPath);

    expect(body).toBe('# Just markdown\n\nNo frontmatter here.');
  });

  it('returns empty string for frontmatter-only file', () => {
    const mdPath = path.join(tmpDir, 'SKILL.md');
    fs.writeFileSync(mdPath, `---
name: test
description: Test
---
`);

    const body = loadSkillBody(mdPath);

    expect(body).toBe('');
  });
});
