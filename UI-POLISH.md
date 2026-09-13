# MCPanel premium UI pass

This build upgrades the frontend into a cohesive commercial hosting interface while preserving the existing backend, authentication, Docker runtime, Modrinth, backups, and deployment work.

## Added product surfaces

- Global command palette / search (`Cmd/Ctrl + K`, or `/` outside text fields)
- Notification center
- Premium server switcher/header controls
- Server-health, resource-alert, update, and maintenance banners
- Recent activity treatment
- First-run onboarding checklist
- Eight-step server launch flow: Welcome, Create server, Version, Loader, RAM, World, Review, Launch
- Toast notification viewport using an application event boundary
- Accessible reusable confirmation dialog
- Skeleton loading state
- Refined empty-state primitive

## Design system changes

- Unified near-black elevated card language
- Tighter typographic hierarchy and consistent tracking
- 8/12/16/24px-oriented spacing rhythm
- Refined borders, subtle gradients, shadows, and hover elevation
- Keyboard-visible focus rings
- Better responsive header behavior
- Accessible Radix-backed dialog/dropdown interactions
- Reduced reliance on native browser prompts

## Keyboard navigation

- `Cmd/Ctrl + K`: open global command palette
- `/`: open command palette when focus is not in an input/textarea
- `Esc`: close dialogs/menus
- Dropdown and dialog keyboard behavior is provided by Radix primitives

## Toast event boundary

Product actions can publish a non-blocking toast without coupling pages to a global state library:

```ts
window.dispatchEvent(new CustomEvent("mcpanel:toast", {
  detail: {
    title: "Backup created",
    description: "World archive is ready.",
    tone: "success",
  },
}));
```

## Validation

A TypeScript/TSX syntax/transpilation pass was run across 112 implementation files with zero diagnostics. The sandbox does not contain project `node_modules`, so dependency-aware `next build`, ESLint, and full `tsc --noEmit` were not runnable in this environment.
