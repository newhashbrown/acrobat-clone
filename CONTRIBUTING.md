# Contributing to Acrobat Clone

Thanks for being interested. This is a personal-scale open-source project — there's no formal team behind it. Issues and PRs are reviewed best-effort by the maintainer (currently just me). No SLA.

## Ground rules

- **Be kind.** See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- **Talk before building anything large.** Open an issue or Discussion before opening a PR that introduces a new feature, a new dependency, or touches >5 files. Small fixes, polish, and documentation can skip this step.
- **Local-first stays a hard constraint.** Anything that requires sending a PDF to a remote service (including for OCR, conversion, or sanitization) is out of scope. The whole point of this project is that your files don't leave your machine.
- **Match the existing code style.** No formatter is enforced yet, but: vanilla TypeScript (no decorators), Zustand for state, React hooks (no class components), plain CSS (no Tailwind, no CSS-in-JS), minimal comments — only where the *why* isn't obvious from the code.
- **No new dependencies without discussion.** Especially anything that adds bundle size, native modules, or telemetry.

## Getting set up

See the [Develop section in README](./README.md#develop). The TL;DR:

```sh
git clone https://github.com/newhashbrown/acrobat-clone.git
cd acrobat-clone
npm install
npm run dev
```

Run `npm run typecheck` before opening a PR — CI will fail otherwise.

## Filing issues

Use the issue templates (`Bug report` or `Feature request`) — they prompt for the info that's usually missing from drive-by reports. For anything sensitive (security, abuse, CoC concerns), see [SECURITY.md](./SECURITY.md) instead.

For open-ended ideas or "is this worth pursuing?" questions, prefer [GitHub Discussions](https://github.com/newhashbrown/acrobat-clone/discussions) over issues. Issues are for actionable items.

## Submitting a PR

1. Fork the repo
2. Create a topic branch: `git checkout -b fix/whatever` or `feat/whatever`
3. Make your change. Keep the diff small and focused — one logical change per PR.
4. Run `npm run typecheck`. Test the change in `npm run dev` against at least one real PDF.
5. Commit with a [conventional](https://www.conventionalcommits.org/) prefix:
   - `feat: …` for new user-visible features
   - `fix: …` for bug fixes
   - `refactor: …` for non-behavioral cleanup
   - `docs: …` for docs-only changes
   - `chore: …` for tooling, deps, CI
6. Push to your fork, open a PR against `main`
7. Fill out the PR template — especially the "How to test" section

## What kinds of contributions are welcome

**Always welcome:**

- Bug fixes
- Test PDFs that break something
- Documentation improvements (the README's "Limitations" section is honest about what's broken — fixes there are great)
- Polish: copy improvements, accessibility fixes, sane defaults, keyboard shortcuts
- Performance improvements with before/after measurements

**Welcome with prior discussion:**

- New features from the [Roadmap](./README.md#roadmap)
- Refactors that touch multiple files
- New dependencies
- Build / packaging changes (electron-builder config, CI)

**Out of scope without strong justification:**

- Cloud features of any kind
- A separate web build
- Mobile (iOS / Android)
- Major UI framework changes (e.g. ripping out React for Solid)
- Locking in to a specific PDF rendering implementation (we're sitting on PDF.js + pdf-lib intentionally)

## Code review

I aim to triage new issues and PRs within a week, but it can slip. Drive-by reviews from other contributors are welcome — leave comments on PRs even if you're not the maintainer.

Constructive disagreement is fine. "I prefer this style" without a reason isn't a useful review comment.

## Testing

There's no test suite right now — this is honest tech debt. The build pipeline runs `tsc` strict on every PR, which catches a lot, but behavior changes are caught by manual testing. If you add a non-trivial feature, please describe how you tested it in the PR description.

A path to a real test setup (Vitest + Playwright on the packaged Electron app) is on the roadmap but unbudgeted. Contributions in that direction are great.

## License

By contributing, you agree your work is licensed under the [MIT License](./LICENSE) that covers this project.
