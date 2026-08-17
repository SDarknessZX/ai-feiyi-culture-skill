# Design QA — SMS login, home, works, and usage-detail integration

## Evidence

- Figma home source: `V:\projerct\audit-output\figma\02-home-source.png` (node `2126:5174`)
- Browser home implementation: `V:\projerct\audit-output\playwright\01-home-375.png`
- Combined home comparison: `V:\projerct\audit-output\comparisons\01-home-side-by-side.png`
- Figma works source: `V:\projerct\audit-output\figma\03-library-source.png` (node `9:15221`)
- Browser works implementation: `V:\projerct\audit-output\playwright\02-library-375.png`
- Combined works comparison: `V:\projerct\audit-output\comparisons\02-library-side-by-side.png`
- User-provided SMS login source: conversation attachment, 914 × 2048 px; the client did not expose a local path
- Browser SMS implementation: `V:\projerct\audit-output\playwright\03-login-dialog-375.png`
- Narrow SMS implementation: `V:\projerct\audit-output\playwright\04-login-dialog-320.png`
- Figma usage-detail source: `V:\projerct\audit-output\figma\01-usage-details-source.png` (node `9:13775`)

Home and works captures are 375 × 812 CSS px and PNG px at device scale factor 1. The narrow SMS capture is 320 × 720 CSS px and PNG px at device scale factor 1. No density normalization was required for those browser/Figma pairs. The SMS attachment is higher density and could not be put into a local combined comparison because the attachment path was unavailable.

## State and runtime verification

- Home: initial anonymous state.
- Works: anonymous empty-library state. The Figma source is a populated-library state, so card-level fidelity cannot be judged precisely.
- SMS dialog: empty form; then arbitrary valid phone `13912345678`, mocked successful send, six-digit code, and trusted Migu redirect.
- Usage detail: mocked verified login callback, mocked server response containing the exact official Migu usage-detail path, same-window navigation confirmed.
- Primary interactions tested: open works, open usage detail, trigger SMS login, send code, verify automatic code-field focus and resend lock, submit code, resume usage-detail navigation.
- Console errors checked: zero application errors or warnings. The third-party Amber SDK was replaced with an empty local test response so external network availability did not contaminate application-console results.
- Responsive check: no document-level horizontal overflow at 320 px.

## Findings

- [P1] Home content and brand copy do not match the selected Figma frame.
  - Location: home header, hero, chips, and template carousel.
  - Evidence: Figma says “智能创作skill / AI创作中心” and shows general AI/football content; implementation says “AI非遗文化skill” and shows heritage-specific copy and imagery.
  - Impact: this is a visible product-positioning difference, not a minor styling variance.
  - Fix: only after owner approval, either update the Figma source to the heritage product direction or align the implementation copy/assets to the selected frame.

- [P2] Home above-the-fold density and carousel composition differ materially.
  - Location: chip rows, card rail, history prompt, and creation tray.
  - Evidence: the Figma frame shows three compact cards above the history prompt; the implementation shows one centered full card plus a partial second card and a much larger blank region before the creation tray.
  - Impact: hierarchy, content discovery, and the perceived amount of available content change noticeably.
  - Fix: after approval, tighten vertical gaps and restore the Figma rail width/card count, or explicitly approve the current single-focus carousel as intentional.

- [P2] Balance/usage-detail affordance lacks a designed unknown-balance state.
  - Location: top-right header on home and works.
  - Evidence: Figma uses a filled pill with a concrete balance; implementation renders “--” with a small text link when balance is unknown.
  - Impact: the usage-detail entry is less prominent and the placeholder looks like unfinished data.
  - Fix: after approval, add an explicit loading/unknown pill state using the same radius, padding, and hierarchy as the Figma balance control.

## Required fidelity surfaces

- Fonts and typography: family and dark navy hierarchy are broadly consistent; brand wording and header wrapping differ as noted above.
- Spacing and layout rhythm: actionable P2 drift remains on the home card rail and vertical whitespace.
- Colors and tokens: pale gray background, navy text, blue active states, and orange retention notice are consistent enough; no independent P1/P2 color issue found.
- Image quality and asset fidelity: implementation imagery is sharp and properly cropped, but subjects differ from the Figma frame as part of the P1 content-direction mismatch.
- Copy and content: actionable P1 brand/product-copy mismatch remains.
- Icons: visible controls use a consistent outline icon family; no broken icon was observed. The works empty state has no matching Figma source state to validate.

## Focused comparison evidence

The full-view home comparison is readable enough to judge its typography, spacing, chips, card imagery, and navigation, so an additional crop was unnecessary. The works pair is deliberately classified as a state mismatch, not a pixel comparison. SMS focused fidelity remains blocked because the user attachment could not be placed beside the browser capture in one local comparison input. The usage-detail page is intentionally delegated to the official Migu H5 page named in the Figma annotation; a real authenticated provider-page screenshot was not captured.

## Comparison history

- Iteration 1: blocked because no approved browser surface was available.
- Iteration 2: Figma usage-detail source captured and official same-window provider integration implemented; runtime evidence still unavailable.
- Iteration 3: user approved isolated Playwright. Browser captures and interaction checks passed. Combined home and works comparisons found the P1/P2 items above. No style changes were applied because the user explicitly requested approval before modifying other screens.

## Implementation checklist

1. Obtain owner decisions for the three P1/P2 visual differences.
2. If approved, align one screen at a time and repeat same-state, same-viewport comparison.
3. Capture a real authenticated official usage-detail page during production smoke testing without exposing tokens or personal data.

final result: blocked
