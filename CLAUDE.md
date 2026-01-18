# CLAUDE.md

**Read [AGENTS.md](AGENTS.md) for all project rules and conventions.**

This file contains Claude Code specific notes only.

## Claude-Specific Tool Usage

- **Use TodoWrite** for multi-step tasks to track progress
- **Prefer Edit over Write** for modifying existing files
- **Use Task tool with Explore agent** for codebase searches and questions
- **Use Task tool with Plan agent** for designing implementation approaches

## Deployment

Railway is the target platform:
1. Connect GitHub repo (auto-deploy on push)
2. Or use Railway CLI: `railway init && railway up`

Configuration is in `railway.toml`.

## TypeScript Notes

- ES modules (`"type": "module"` in package.json)
- Module resolution: `NodeNext`
- Target: ES2022
- Strict mode enabled
- Output: `dist/` directory
