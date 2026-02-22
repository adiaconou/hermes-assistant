/**
 * Unit tests for skill registry (loadSkillsFromDir, buildRegistry).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/domains/skills/repo/filesystem.js', () => ({
  discoverSkillDirs: vi.fn(),
  readSkillMd: vi.fn(),
}));

import { loadSkillsFromDir, buildRegistry } from '../../../src/domains/skills/service/registry.js';
import { discoverSkillDirs, readSkillMd } from '../../../src/domains/skills/repo/filesystem.js';

const VALID_SKILL_MD = `---
name: my-skill
description: A test skill
metadata:
  hermes:
    channels:
      - sms
    match:
      - test
    enabled: true
---
Body content.
`;

const INVALID_SKILL_MD = `---
name: Invalid Name!
description: Bad skill
---
`;

describe('loadSkillsFromDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty state for nonexistent directory (no discovered dirs)', () => {
    vi.mocked(discoverSkillDirs).mockReturnValue([]);

    const result = loadSkillsFromDir('/nonexistent', 'bundled');

    expect(result.skills).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('loads a valid skill directory', () => {
    vi.mocked(discoverSkillDirs).mockReturnValue(['/skills/my-skill']);
    vi.mocked(readSkillMd).mockReturnValue(VALID_SKILL_MD);

    const result = loadSkillsFromDir('/skills', 'bundled');

    expect(result.skills).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.skills[0].name).toBe('my-skill');
    expect(result.skills[0].description).toBe('A test skill');
    expect(result.skills[0].channels).toEqual(['sms']);
    expect(result.skills[0].matchHints).toEqual(['test']);
    expect(result.skills[0].enabled).toBe(true);
    expect(result.skills[0].source).toBe('bundled');
  });

  it('records error for skill with invalid frontmatter', () => {
    vi.mocked(discoverSkillDirs).mockReturnValue(['/skills/bad-skill']);
    vi.mocked(readSkillMd).mockReturnValue(INVALID_SKILL_MD);

    const result = loadSkillsFromDir('/skills', 'imported');

    expect(result.skills).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].skillDir).toBe('/skills/bad-skill');
    expect(result.errors[0].source).toBe('imported');
  });

  it('records error when readSkillMd throws', () => {
    vi.mocked(discoverSkillDirs).mockReturnValue(['/skills/broken']);
    vi.mocked(readSkillMd).mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });

    const result = loadSkillsFromDir('/skills', 'bundled');

    expect(result.skills).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('ENOENT');
  });

  it('defaults channels to sms and whatsapp when not specified', () => {
    const minimalMd = `---
name: minimal
description: No hermes metadata
---
`;
    vi.mocked(discoverSkillDirs).mockReturnValue(['/skills/minimal']);
    vi.mocked(readSkillMd).mockReturnValue(minimalMd);

    const result = loadSkillsFromDir('/skills', 'bundled');

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].channels).toEqual(['sms', 'whatsapp']);
    expect(result.skills[0].matchHints).toEqual([]);
    expect(result.skills[0].enabled).toBe(true);
  });
});

describe('buildRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges bundled and imported skills, imported overrides bundled', () => {
    const bundledMd = `---
name: shared-skill
description: Bundled version
metadata:
  hermes:
    channels:
      - sms
---
`;
    const importedMd = `---
name: shared-skill
description: Imported version
metadata:
  hermes:
    channels:
      - whatsapp
---
`;
    const bundledOnlyMd = `---
name: bundled-only
description: Only in bundled
---
`;

    // First call is for bundled dir, second for imported dir
    vi.mocked(discoverSkillDirs)
      .mockReturnValueOnce(['/bundled/shared-skill', '/bundled/bundled-only'])
      .mockReturnValueOnce(['/imported/shared-skill']);

    vi.mocked(readSkillMd)
      .mockReturnValueOnce(bundledMd)
      .mockReturnValueOnce(bundledOnlyMd)
      .mockReturnValueOnce(importedMd);

    const result = buildRegistry('/bundled', '/imported');

    expect(result.skills).toHaveLength(2);
    const sharedSkill = result.skills.find(s => s.name === 'shared-skill');
    expect(sharedSkill?.description).toBe('Imported version');
    expect(sharedSkill?.source).toBe('imported');

    const bundledOnly = result.skills.find(s => s.name === 'bundled-only');
    expect(bundledOnly?.source).toBe('bundled');
  });

  it('collects errors from both bundled and imported', () => {
    vi.mocked(discoverSkillDirs)
      .mockReturnValueOnce(['/bundled/bad'])
      .mockReturnValueOnce(['/imported/bad']);

    vi.mocked(readSkillMd).mockImplementation(() => {
      throw new Error('parse error');
    });

    const result = buildRegistry('/bundled', '/imported');

    expect(result.skills).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].source).toBe('bundled');
    expect(result.errors[1].source).toBe('imported');
  });
});
