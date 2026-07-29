repo: jmbish04/core-remodel
branch: main
path: src/frontend

## Last sync

date: 2026-07-27T00:37:23Z

### Updated in this project

- Derived the design system (tokens, type, geometry, component vocabulary, app chrome) from the live frontend source.
- Recreated the admin/public sidebar + AppHeader chrome as a reference frame for new pages.
- Swapped hand-drawn glyphs for real Lucide icons, matching the icons named in the source components.

## Screen map

| Project screen | Repo files |
| --- | --- |
| Design System.dc.html | src/frontend/styles/global.css, components.json, src/frontend/components/ui/{button,card,badge}.tsx, src/frontend/components/sidebar/{shared,PublicSidebar,nav-groups}.{tsx,ts}, src/frontend/components/AppHeader.tsx, src/frontend/lib/config.ts, src/frontend/components/workshop/WorkshopApp.tsx, src/frontend/components/config/ConfigShell.tsx, src/frontend/components/Icons.tsx |
