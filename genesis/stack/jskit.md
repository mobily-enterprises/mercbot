# Stack customization: jskit

## Add

### Guidance

- When building or changing screens, `docs/ui-style.md` (Mercbot's own style) takes precedence over any Material 3
  guidance from JSKIT.

## Override

### UI pass

- Check every screen in scope against `docs/ui-style.md`, Mercbot's own visual style, following its "UI pass method"
  section for the resolved scope: the changes, a section, or the whole app.
- Run `npx jskit check` until it passes (its navigation rules must hold) and `npm run lint`, and look at every
  screenshot for layout, spacing and contrast, which no check sees.
