# Approved OctoBooks icon

`source.png` is the user's approved cap-and-pencil icon: E1 graduation cap combined with E3 pencil, round glasses, short white tentacles and a teal tile. It was created with the built-in image generation tool and copied unchanged from the approved local gallery. SHA256: `b0e9cb539d4cfec2501ccb73c68d26f5ec9b3d13b0ec2b57848e3db7592395f9`.

Regenerate all platform assets with `node scripts/gen-icons.mjs`, using the repository's existing Playwright Chromium. No image API or new dependency is required. The master is not regenerated or overwritten by this script.

- Desktop/UI/web: resize the approved icon, retaining its transparent outer margin.
- iOS and Android legacy launcher: fill the platform background and scale the approved tile to the full square; iOS remains fully opaque.
- Android adaptive foreground: extract only the white mascot and fit it within the circular safe area; the existing teal background resource remains.
- Tray: the same extracted mascot rendered as a black alpha mask.
- Splash: the approved icon and OctoBooks wordmark on the existing light background.

Generated SVG files are raster wrappers, not hand-authored vector artwork. The source remains teal independently of the selectable UI theme.
