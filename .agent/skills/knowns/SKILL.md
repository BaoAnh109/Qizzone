---
name: knowns
description: Use when working in a repository with .knowns/, when managing tasks, docs, specs, decisions, or memory for AI coding agents, or when the user asks to use Knowns to inspect project context and prevent breaking architectural decisions.
---

# Knowns: Project Memory & Architectural Integrity Layer

Knowns is a local-first repository memory and context layer for AI coding assistants. It keeps tasks, documentation, specs, memory, and architectural decisions as plain Markdown files inside the `.knowns/` directory of the repository.

**Core Principle:** AI should read, not guess. Explicit context beats implicit memory.

---

## When to Use This Skill

Activate this skill whenever:
1. The repository contains a `.knowns/` folder.
2. The user references Knowns, `.knowns`, or `KNOWNS.md`.
3. The user asks to manage tasks, specs, decisions, docs, or project memory using Knowns.
4. The user asks to verify that code changes adhere to existing architectural decisions.

---

## Critical Rules

1. **Never manually edit Knowns-managed markdown files** (such as files inside `.knowns/tasks/`, `.knowns/docs/`, `.knowns/decisions/`). Always use the `knowns` CLI or MCP tools to read, create, and update them.
2. **Read before acting:** Search docs, tasks, and system decisions before proposing or writing code.
3. **Respect System Decisions:** Architectural decisions recorded in `.knowns/decisions/` are binding. Do not break or silently override existing decisions.
4. **Plan before implementation:** Establish clear steps and acceptance criteria (ACs) before writing code.
5. **Validate before complete:** Run project checks, tests, and SDD verification before concluding tasks.

---

## Workflow Skills Map

Knowns ships with specialized workflow skills. Use them for specific phases of work:

| Skill | Purpose | When to Use |
| :--- | :--- | :--- |
| `kn-init` | Session bootstrap | Start of session: reads project docs, context, and backlog |
| `kn-research` | Context exploration | Understand existing codebase, patterns, and decisions |
| `kn-decision` | Architectural decisions | Create, review, promote, or supersede System Decisions |
| `kn-spec` | Spec-Driven Dev (SDD) | Create a feature specification document |
| `kn-plan` | Task planning | Create implementation plan with ACs and dependencies |
| `kn-implement` | Implementation | Execute plan step-by-step, validating ACs progressively |
| `kn-test` | Test generation | Generate tests from spec criteria and track unproven ACs |
| `kn-review` | Code review | Multi-perspective pre-commit review |
| `kn-verify` | SDD verification | Run verification checks and coverage report |
| `kn-commit` | Conventional commit | Create conventional commits with verification |
| `kn-debug` | Structured triage | Debug errors, test failures, and capture lessons |
| `kn-extract` | Knowledge extraction | Extract reusable patterns and decisions into docs |
| `kn-flow` | Full orchestration | End-to-end orchestration from approved spec to verification |
| `kn-handoff` | Cross-repo handoff | Briefs and API contracts crossing repository boundaries |

---

## CLI Reference Cheatsheet

Always use `--plain` flag when running Knowns CLI commands in agent sessions for clean, parseable text output.

### 1. Project Health & Status
```bash
knowns status --plain           # Project readiness and backlog summary
knowns doctor --plain           # Diagnose integration and configuration health
knowns init                     # Initialize Knowns in the current repo (if new)
knowns setup antigravity        # Configure Antigravity integration for current repo
```

### 2. Architectural Decisions
```bash
knowns decision list --plain              # List all System Decisions
knowns decision <id> --plain              # View specific decision details
knowns decision create --title "<title>"  # Draft a new decision
```

### 3. Tasks
```bash
knowns task list --plain                  # List all tasks and statuses
knowns task <id> --plain                  # Inspect task details and acceptance criteria
knowns task create --title "<title>"      # Create a new task
knowns task update <id> --status in_progress # Update task state
```

### 4. Docs & Knowledge
```bash
knowns doc list --plain                   # List documentation
knowns doc "<path>" --plain --smart       # Read doc with smart reference resolution
knowns search "<query>" --plain           # Search docs, tasks, and decisions
knowns retrieve "<query>" --json          # Retrieve ranked, structured context pack
```

### 5. Memory
```bash
knowns memory list --plain                # List persistent project memories
knowns memory add --category "<cat>" --content "<content>" # Add persistent memory
```

---

## Standard Workflow

```
kn-init ──> kn-research ──> kn-plan ──> kn-implement ──> kn-review ──> kn-commit
                                                │
                                                └──> kn-decision (if architectural changes arise)
```
