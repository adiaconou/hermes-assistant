/**
 * Filesystem skill type definitions.
 */

export type SkillChannel = 'sms' | 'whatsapp' | 'scheduler' | 'email';

export type SkillFrontmatter = {
  name: string;
  description: string;
  metadata?: {
    hermes?: {
      channels?: SkillChannel[];
      tools?: string[];
      match?: string[];
      enabled?: boolean;
      delegateAgent?: string;
    };
  };
};

export type LoadedSkill = {
  name: string;
  description: string;
  markdownPath: string;
  rootDir: string;
  channels: SkillChannel[];
  tools: string[];
  matchHints: string[];
  enabled: boolean;
  source: 'bundled' | 'imported';
  delegateAgent?: string | null;
};

export type SkillLoadError = {
  skillDir: string;
  error: string;
  source: 'bundled' | 'imported';
};

export type SkillMatch = {
  skill: LoadedSkill;
  confidence: number;
  rationale: string;
};

export type SkillExecutionResult = {
  success: boolean;
  output: string | null;
  error?: string;
};
