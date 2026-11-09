# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Qizzone
**Generated:** 2026-11-09 14:44:03
**Category:** General
**Design Dials:** Variance 5/10 (Balanced / Modern) | Motion 2/10 (Subtle) | Density 6/10 (Standard)

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#2563EB` | `--color-primary` |
| On Primary | `#FFFFFF` | `--primary-foreground` |
| Secondary | `#0F766E` | `--color-secondary` |
| On Secondary | `#FFFFFF` | `--secondary-foreground` |
| Accent/CTA | `#F59E0B` | `--color-accent` |
| On Accent/CTA | `#0F172A` | `--accent-foreground` |
| Background | `#EFF6FF` | `--background` |
| Foreground | `#0F172A` | `--foreground` |
| Card | `#FFFFFF` | `--surface` |
| Card Foreground | `#0F172A` | `--text-primary` |
| Muted | `#F1F5FD` | `--surface-muted` |
| Muted Foreground | `#64748B` | `--text-muted` |
| Border | `#DBE5F2` | `--color-border` |
| Destructive | `#DC2626` | `--danger-action` |
| On Destructive | `#FFFFFF` | `--danger-action-foreground` |
| Ring | `#2563EB` | `--focus` |

**Color Notes:** Blue is the primary action and navigation color; teal is the secondary accent; gold is reserved for highlights and warnings. Green, amber, and red remain distinct for success, caution, and error states.

### Dark Theme

The same semantic tokens switch when `html[data-theme="dark"]` is active. The background is `#0B1220`, cards use `#111C2F`, raised surfaces use `#1B2940`, primary text uses `#F1F5F9`, secondary text uses `#CBD5E1`, muted text uses `#94A3B8`, and borders use `#344861`. Status colors keep their meaning while changing surface, border, and foreground together.

### Typography

- **Heading Font:** Outfit
- **Body Font:** Work Sans
- **Mood:** geometric, modern, clean, balanced, contemporary, versatile
- **Google Fonts:** [Outfit + Work Sans](https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Work+Sans:wght@300;400;500;600;700&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Work+Sans:wght@300;400;500;600;700&display=swap');
```

### Spacing Variables

*Density: 6/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: var(--primary);
  color: var(--primary-foreground);
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  background: var(--primary-hover);
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: var(--primary-hover);
  border: 1px solid var(--border-strong);
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: var(--surface);
  border-radius: 12px;
  padding: var(--space-card);
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: var(--focus);
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 20%, transparent);
}
```

### Shared Theme Utilities

Use the semantic classes in every screen so the active theme supplies the actual color:

```tsx
<main className="app-shell">
  <section className="theme-surface theme-border rounded-xl border p-card">
    <h1 className="page-heading">Tiêu đề trang</h1>
    <p className="theme-text-secondary">Mô tả</p>
  </section>
</main>
```

Prefer `theme-surface`, `theme-surface-muted`, `theme-surface-inset`, `theme-text-primary`, `theme-text-secondary`, `theme-text-muted`, and `theme-border` over raw neutral colors. Use the status utilities for informational, success, warning, and error states. `html[data-theme="dark"]` activates the dark token set; the saved preference is applied before React renders to avoid a light-theme flash.

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential

**Best For:** Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools

**Key Effects:** Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading

### Page Pattern

**Pattern Name:** Role Dashboard + Task Flow

- **Conversion Strategy:** Put the page title and the main task/action first. Keep assignment lists, filters, and progress summaries scannable; use an empty state that tells the user what to do next.
- **CTA Placement:** Near the task it affects; keep one clear primary action per view.
- **Section Order:** Page heading and short context > primary task or summary > supporting lists/details > secondary actions.

---

## Motion

**Interaction Motion** (Subtle) — Duration: 150-200ms | Easing: `ease-out`

```js
element.animate([{ opacity: 0.92 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
```

**Framework notes:** Use motion only for feedback (hover, focus, loading, opening panels); respect `prefers-reduced-motion` and keep layout stable.

- ✅ Keep transitions short and limit them to opacity, color, and shadow
- ❌ Avoid scroll-triggered reveals in dense work screens and exam flows
- ⚡ Keep navigation and answer feedback immediate

---

## Anti-Patterns (Do NOT Use)


### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
