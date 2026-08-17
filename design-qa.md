# Design QA — SMS login reference match

## Evidence

- Source visual truth: user-provided SMS login screenshot in this conversation, 914 × 2048 px. The client did not expose a local attachment path.
- Initial implementation: `V:\projerct\audit-output\playwright\03-login-dialog-375.png`, 375 × 812 px at device scale factor 1.
- Revised implementation: `V:\projerct\audit-output\playwright\07-login-dialog-final-375.png`, 375 × 812 px at device scale factor 1.
- Narrow implementation: `V:\projerct\audit-output\playwright\08-login-dialog-final-320.png`, 320 × 700 px at device scale factor 1.
- State: anonymous first visit, empty phone/code form, phone field automatically focused.

The source is a higher-density mobile screenshot. The implementation captures use CSS-pixel density. The modal was compared by proportional geometry: card-to-viewport width, square card ratio, scan-frame region, title/input/button hierarchy, and confirmation-button placement.

## Runtime verification

- The login dialog opens automatically for an anonymous visitor.
- Phone and verification-code inputs remain usable at 375 px and 320 px.
- The code button and confirmation button remain inside the card with no horizontal overflow.
- Automatic phone focus no longer produces the heavy black outline shown in the rejected implementation.
- The Playwright captures completed successfully in installed Chrome.

## Findings

- No remaining P0/P1/P2 implementation issue was visible in the revised 375 px or 320 px captures.
- [P3] Exact source-to-capture pixel overlay remains unavailable because the conversation attachment has no local file path.

## Required fidelity surfaces

- Fonts and typography: the title was reduced to the source hierarchy; control labels and placeholders retain readable weights at both widths.
- Spacing and layout rhythm: the dialog is square, the scan frame encloses the title and two inputs, and the confirmation action sits independently below it as in the reference.
- Colors and visual tokens: white card, charcoal copy, pale input fills, black send-code button, gray disabled confirmation, red REC indicator, and dark overlay match the source palette.
- Image quality and asset fidelity: no raster imagery is required in this modal. The scan treatment and REC indicator use the existing Lucide icon set and remain sharp at both sizes.
- Copy and content: title, placeholders, send-code label, and confirmation label match the reference.

## Focused comparison evidence

The dialog itself occupies most of each capture, so a separate crop would not reveal additional typography or control detail. The 320 px capture serves as the focused responsive check.

## Comparison history

- Iteration 1: rejected implementation was a tall card with a scan frame extending through the confirmation area and a heavy focused-input outline.
- Iteration 2: changed to a square card, compressed typography and controls, removed the heavy focus outline, and shortened the scan region; the lower scan corners still intersected the code row.
- Iteration 3: moved the lower scan corners below the code row and moved confirmation into the independent lower action area. Revised 375 px and 320 px captures show no P0/P1/P2 issue.

## Implementation checklist

1. Deploy the revised CSS and component viewBox.
2. Recheck the same anonymous state over the production HTTPS domain.
3. Preserve the four SMS credentials only in the server-side `.env.local` file.

final result: blocked
