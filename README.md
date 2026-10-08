# worktree-setup

Seed gitignored-but-needed files (`.env`, `.npmrc`, `.idea`, …) from a repo's
**main checkout** into a freshly-created git **worktree**.

Git worktrees only materialize *tracked* files, so anything gitignored is left
behind. `worktree-setup` fills that gap using the portable
[`.worktreeinclude`](https://github.com/satococoa/git-worktreeinclude) manifest
(the same file Claude Code, Conductor, Codex and others read).

- **files → symlinked** into the main checkout (edits stay in sync)
- **directories → copied** (independent per-worktree copy — no IDE-state conflicts for `.idea`)
- only paths that are **actually gitignored** are touched (safety)

## The manifest

Put a `.worktreeinclude` at the repo root (gitignore-style syntax):

```
.env
.env.*
.npmrc
.idea/
```

If a repo has no `.worktreeinclude`, these four entries are used as defaults.

## Usage

Run from inside the worktree you want to seed:

```bash
worktree-setup            # seed this worktree from the main checkout
worktree-setup --dry-run  # preview without changing anything
worktree-setup --force    # overwrite entries that already exist
worktree-setup --help
```

The source (main checkout) is auto-detected via `git worktree list`; the target
is the current worktree (`git rev-parse --show-toplevel`).

## Install

```bash
bun run build                                   # → dist/worktree-setup
ln -sf "$PWD/dist/worktree-setup" ~/.bun/bin/   # put it on your PATH
```

Rebuild + the symlink stays pointed at the latest binary.

## Notes

- Built with [Bun](https://bun.com): `Bun.file` / `Bun.Glob` for filesystem
  reads and ``Bun.$`…` `` for `git`, `ln`, `cp`. No `node:fs`.
- `.worktreeinclude` negation (`!`) is not yet supported; comments (`#`) and
  globs are.
