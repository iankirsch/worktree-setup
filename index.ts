#!/usr/bin/env bun
import { $ } from 'bun'
import { dirname, join } from 'node:path'

const DEFAULT_MANIFEST = ['.env', '.env.*', '.npmrc', '.idea/']

const HELP = `worktree-setup — seed gitignored files into a git worktree

Usage:
  worktree-setup [options]

Run from inside a linked git worktree. Copies/symlinks the gitignored files
listed in .worktreeinclude (at the main worktree root) into the current worktree:
  • files       → symlinked (stay in sync with the main checkout)
  • directories → copied (independent per-worktree copy)
Only paths that are actually gitignored are touched. If no .worktreeinclude
exists, the defaults are: ${DEFAULT_MANIFEST.join(', ')}

Options:
  -n, --dry-run   Show what would happen without changing anything
  -f, --force     Overwrite entries that already exist in the worktree
  -h, --help      Show this help
`

interface Flags {
    force: boolean
    dryRun: boolean
    help: boolean
}

function parseFlags(argv: string[]): Flags {
    return {
        force: argv.includes('--force') || argv.includes('-f'),
        dryRun: argv.includes('--dry-run') || argv.includes('-n'),
        help: argv.includes('--help') || argv.includes('-h'),
    }
}

async function gitToplevel(cwd: string): Promise<string | null> {
    const res = await $`git rev-parse --show-toplevel`.cwd(cwd).nothrow().quiet()
    if (res.exitCode !== 0) return null
    return res.stdout.toString().trim() || null
}

async function mainWorktree(cwd: string): Promise<string | null> {
    const res = await $`git worktree list --porcelain`.cwd(cwd).nothrow().quiet()
    if (res.exitCode !== 0) return null
    for (const line of res.stdout.toString().split('\n')) {
        if (line.startsWith('worktree ')) return line.slice('worktree '.length).trim()
    }
    return null
}

async function isIgnored(cwd: string, relPath: string): Promise<boolean> {
    return (await $`git check-ignore ${relPath}`.cwd(cwd).nothrow().quiet()).exitCode === 0
}

async function pathExists(p: string): Promise<boolean> {
    return (await $`test -e ${p}`.nothrow().quiet()).exitCode === 0
}

async function isDirectory(p: string): Promise<boolean> {
    return (await $`test -d ${p}`.nothrow().quiet()).exitCode === 0
}

async function readManifest(source: string): Promise<string[]> {
    const file = Bun.file(join(source, '.worktreeinclude'))
    if (!(await file.exists())) return DEFAULT_MANIFEST
    return (await file.text())
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
}

async function resolveEntries(source: string, patterns: string[]): Promise<string[]> {
    const resolved = new Set<string>()
    for (const raw of patterns) {
        const pattern = raw.replace(/\/+$/, '')
        if (pattern.length === 0) continue
        if (await pathExists(join(source, pattern))) {
            resolved.add(pattern)
            continue
        }
        const glob = new Bun.Glob(pattern)
        for (const match of glob.scanSync({ cwd: source, dot: true, onlyFiles: false })) {
            resolved.add(match)
        }
    }
    return [...resolved]
}

async function main(): Promise<number> {
    const flags = parseFlags(Bun.argv.slice(2))
    if (flags.help) {
        console.log(HELP)
        return 0
    }

    const cwd = process.cwd()
    const target = await gitToplevel(cwd)
    if (!target) {
        console.error('error: not inside a git repository')
        return 1
    }

    const source = await mainWorktree(cwd)
    if (!source) {
        console.error('error: could not determine the main worktree')
        return 1
    }
    if (source === target) {
        console.log('Already in the main checkout — nothing to seed.')
        return 0
    }

    const entries = await resolveEntries(source, await readManifest(source))
    if (entries.length === 0) {
        console.log('Nothing to seed (no matching gitignored files).')
        return 0
    }

    const symlinked: string[] = []
    const copied: string[] = []
    const skipped: string[] = []
    const warnings: string[] = []

    for (const rel of entries) {
        const src = join(source, rel)
        const dest = join(target, rel)

        if (!(await pathExists(src))) {
            warnings.push(`${rel} — not found in main checkout`)
            continue
        }
        if (!(await isIgnored(source, rel))) {
            warnings.push(`${rel} — not gitignored, skipping for safety`)
            continue
        }

        const destExists = await pathExists(dest)
        if (destExists && !flags.force) {
            skipped.push(`${rel} — already exists (use --force to overwrite)`)
            continue
        }

        const dir = await isDirectory(src)
        const verb = dir ? 'copy' : 'symlink'

        if (flags.dryRun) {
            console.log(`would ${verb}: ${rel}`)
            continue
        }

        if (destExists && flags.force) await $`rm -rf ${dest}`.nothrow().quiet()
        await $`mkdir -p ${dirname(dest)}`.nothrow().quiet()

        if (dir) {
            await $`cp -R ${src} ${dest}`.quiet()
            copied.push(rel)
        } else {
            await $`ln -s ${src} ${dest}`.quiet()
            symlinked.push(rel)
        }
    }

    if (flags.dryRun) return 0

    for (const rel of symlinked) console.log(`symlinked  ${rel}`)
    for (const rel of copied) console.log(`copied     ${rel}`)
    for (const msg of skipped) console.log(`skipped    ${msg}`)
    for (const msg of warnings) console.warn(`warning    ${msg}`)

    const changed = symlinked.length + copied.length
    console.log(
        `\nDone: ${changed} seeded (${symlinked.length} symlinked, ${copied.length} copied), ` +
            `${skipped.length} skipped, ${warnings.length} warnings.`
    )
    return 0
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error(err)
        process.exit(1)
    })
