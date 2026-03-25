# Contributing to ThoughtLayer

Thanks for your interest in contributing. ThoughtLayer is an open-core project: the core engine is MIT-licensed and accepts contributions.

## Getting Started

```bash
git clone https://github.com/prasants/thoughtlayer.git
cd thoughtlayer
npm install --include=dev
npx tsc
npx vitest run
```

## Development Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add tests for new functionality
4. Run `npx vitest run` and ensure all tests pass
5. Run `npx tsc --noEmit` to check types
6. Open a PR against `main`

## What We're Looking For

- **Bug fixes** with a test that reproduces the issue
- **Retrieval improvements** backed by benchmark data (run `npx tsx benchmarks/run.ts`)
- **New embedding providers** (Ollama, Cohere, local models)
- **Documentation** improvements and examples
- **Performance** optimisations with before/after measurements

## Code Style

- TypeScript strict mode
- No `any` types without justification
- Descriptive variable names over comments
- Tests live in `tests/` and mirror `src/` structure

## Architecture Decisions

If your PR changes the retrieval pipeline, storage format, or public API, open an issue first to discuss. We want to keep the core small and fast.

## Reporting Issues

- Use the GitHub issue templates
- Include: what you expected, what happened, steps to reproduce
- For retrieval quality issues, include the query, expected result, and actual result

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
