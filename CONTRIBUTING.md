# Contributing to TrainBud

Thanks for your interest in contributing!

## Getting started

```bash
git clone https://github.com/Zsadigzade/trainbud.git
cd trainbud
npm install
npm run build
npm test
```

## Before submitting a PR

1. Run `npm run typecheck`, `npm test`, and `npm run lint`
2. Keep changes focused — one concern per PR
3. Update docs if you change CLI commands, env vars, or tool behavior
4. Do not commit `.env`, `.trainbud/`, or credentials

## Project layout

See [docs/VAULT.md](./docs/VAULT.md) for the source structure and design decisions (Obsidian vault at `05-Projects/trainbud/`).

## Reporting issues

Open an issue at [github.com/Zsadigzade/trainbud/issues](https://github.com/Zsadigzade/trainbud/issues) with:

- OS and Node version
- Steps to reproduce
- Relevant log output from `.trainbud/mcp.log` (redact credentials)

## Code style

- TypeScript strict mode
- Match existing patterns in surrounding files
- No unnecessary abstractions — keep diffs small

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
