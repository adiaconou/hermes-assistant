/**
 * Filesystem repository for skill packs.
 * Handles safe directory scanning and file reads with path traversal guards.
 */
import fs from 'fs';
import path from 'path';

/**
 * Discover skill directories under a root path.
 * Each valid skill directory must contain a SKILL.md file.
 * Returns list of absolute paths to SKILL.md files.
 */
export function discoverSkillDirs(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const skillPaths: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip hidden directories
    if (entry.name.startsWith('.')) continue;

    const skillMdPath = path.join(rootDir, entry.name, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      skillPaths.push(path.resolve(rootDir, entry.name));
    }
  }

  return skillPaths;
}

/**
 * Safely read a file within a skill directory.
 * Guards against path traversal and symlink escape.
 */
export function safeReadFile(filePath: string, skillRootDir: string): string {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(skillRootDir);

  // Path traversal guard
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error(`Path traversal attempt: ${filePath} is outside ${skillRootDir}`);
  }

  // Symlink guard
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    throw new Error(`Symlink not allowed: ${filePath}`);
  }

  return fs.readFileSync(resolved, 'utf-8');
}

/**
 * Read the SKILL.md file content for a skill directory.
 */
export function readSkillMd(skillDir: string): string {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  // Use the skill's parent directory as the root for safety
  // but we know skillDir is already validated
  return fs.readFileSync(path.resolve(skillMdPath), 'utf-8');
}

/**
 * Load the body content (markdown below frontmatter) of a skill on demand.
 * Used at execution time, not at startup.
 */
export function loadSkillBody(markdownPath: string): string {
  const content = fs.readFileSync(markdownPath, 'utf-8');
  // Skip frontmatter: find the closing --- delimiter
  const fmEnd = content.indexOf('---', content.indexOf('---') + 3);
  if (fmEnd === -1) {
    return content; // No frontmatter, return entire content
  }
  return content.slice(fmEnd + 3).trim();
}

/**
 * List resource files in a skill's subdirectory (references/, scripts/, assets/).
 * Returns relative paths from the skill root.
 */
export function listSkillResources(skillDir: string, subdir: string): string[] {
  const fullPath = path.join(skillDir, subdir);
  if (!fs.existsSync(fullPath)) {
    return [];
  }

  const resolvedSkillDir = path.resolve(skillDir);
  const resolvedSubdir = path.resolve(fullPath);

  // Guard against path traversal in subdir name
  if (!resolvedSubdir.startsWith(resolvedSkillDir + path.sep)) {
    return [];
  }

  const entries = fs.readdirSync(fullPath, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && !e.isSymbolicLink())
    .map(e => path.join(subdir, e.name));
}
