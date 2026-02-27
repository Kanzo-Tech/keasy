---
phase: 09-gaia-x-compliance-wizard
plan: 02
subsystem: web
tags: [gaia-x, compliance-wizard, next-js, shadcn, swr, react-hook-form, vertical-stepper, file-upload]

# Dependency graph
requires:
  - phase: 09-01
    provides: "9 backend wizard endpoints at /v1/gaia-x/*, compliance status and rerun endpoints"

provides:
  - "9 Next.js proxy routes forwarding /api/compliance/** to /v1/gaia-x/** backend"
  - "WizardLayout: two-column shell with WizardStepper sidebar + right content area + nav buttons"
  - "WizardStepper: vertical step list with checkmarks (completed), filled circle (current), dimmed (pending)"
  - "Free navigation: completed steps clickable, pending steps disabled"
  - "StepKeyPair: P-256 key generation + PEM download trigger"
  - "StepDidHosting: certificate drag-and-drop upload + domain display + DID doc collapsible"
  - "StepLrn: VAT/LEI/EORI type selector + registration number form"
  - "StepLegalParticipant: legal name + country code + private key upload for in-memory signing"
  - "StepTerms: T&C scroll area + private key upload for in-memory signing"
  - "StepGxdchSubmit: credential previews + step-by-step progress + retry on failure"
  - "Wizard page at /compliance/wizard with SWR state load + free navigation + auto-save"

affects:
  - "09-03 (compliance management view) — /api/compliance/status and /api/compliance/rerun routes ready"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "proxy route pattern: try/catch around fetch, 502 on network error, forward Set-Cookie headers"
    - "wizard page: SWR gx-wizard key, effectiveStep = currentStep state ?? wizardState.current_step"
    - "free navigation: isStepCompleted(index, state) guards onStepChange to prevent jumping ahead"
    - "PEM download: URL.createObjectURL(Blob) + anchor click + URL.revokeObjectURL"
    - "drag-and-drop upload: onDragOver/onDragLeave/onDrop + hidden file input ref fallback"
    - "step-by-step progress: setTimeout(600ms) + fetch state tracking for 4 UI phases"
    - "credential previews: CredentialPreview sub-component with Collapsible JSON viewer"

key-files:
  created:
    - "web/src/app/api/compliance/wizard/route.ts — GET proxy to /v1/gaia-x/wizard"
    - "web/src/app/api/compliance/wizard/keys/route.ts — POST proxy to /v1/gaia-x/wizard/keys"
    - "web/src/app/api/compliance/wizard/certificate/route.ts — POST proxy to /v1/gaia-x/wizard/certificate"
    - "web/src/app/api/compliance/wizard/lrn/route.ts — POST proxy to /v1/gaia-x/wizard/lrn"
    - "web/src/app/api/compliance/wizard/legal-participant/route.ts — POST proxy to /v1/gaia-x/wizard/legal-participant"
    - "web/src/app/api/compliance/wizard/terms/route.ts — POST proxy to /v1/gaia-x/wizard/terms"
    - "web/src/app/api/compliance/wizard/submit/route.ts — POST proxy to /v1/gaia-x/wizard/submit"
    - "web/src/app/api/compliance/status/route.ts — GET proxy to /v1/gaia-x/compliance"
    - "web/src/app/api/compliance/rerun/route.ts — POST proxy to /v1/gaia-x/compliance/rerun"
    - "web/src/components/compliance/wizard-layout.tsx — two-column wizard shell with nav buttons"
    - "web/src/components/compliance/wizard-stepper.tsx — vertical stepper with status icons + connector lines"
    - "web/src/components/compliance/steps/step-key-pair.tsx — key generation + PEM download"
    - "web/src/components/compliance/steps/step-did-hosting.tsx — cert upload + DID doc display"
    - "web/src/components/compliance/steps/step-lrn.tsx — LRN type/value form"
    - "web/src/components/compliance/steps/step-legal-participant.tsx — LP credential signing"
    - "web/src/components/compliance/steps/step-terms.tsx — T&C display + signing"
    - "web/src/components/compliance/steps/step-gxdch-submit.tsx — VP preview + submission progress"
    - "web/src/app/(main)/compliance/wizard/page.tsx — wizard page shell wiring all steps"
  modified: []

key-decisions:
  - "effectiveStep pattern: wizard page tracks currentStep in local state (null = use wizardState.current_step) — handles first-mount without flicker"
  - "Free navigation guard: isStepCompleted() checks wizardState fields per step; onStepChange only fires for completed steps"
  - "Submit retry: StepGxdchSubmit shows Retry Submission button when phase === error — resets to idle on retry"
  - "Localhost/private IP detection: isLocalhostOrPrivateIp() checks domain prefix patterns, shows Alert in StepDidHosting per research pitfall 5"

# Metrics
duration: 5min
completed: 2026-02-27
---

# Phase 09 Plan 02: Gaia-X Compliance Wizard Frontend Summary

**Complete frontend compliance wizard with 9 Next.js proxy routes, vertical stepper layout with free navigation, and 6 step components covering P-256 key generation, X.509 certificate upload, LRN/LP/TC credential signing, and GXDCH submission with step-by-step progress**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-27T01:28:27Z
- **Completed:** 2026-02-27T01:33:29Z
- **Tasks:** 2
- **Files modified:** 18 (18 created, 0 modified)

## Accomplishments

- Created all 9 Next.js proxy route files following the exact pattern from existing auth proxy routes
- Built WizardStepper with visual status indicators: green check circles for completed, filled primary for current, dimmed with number for pending, connector lines between steps
- Built WizardLayout: two-column shell (w-64 sidebar + flex-1 content) with Back/Next navigation
- Implemented all 6 step components with full form fields, API calls, error handling, and credential JSON viewers
- StepKeyPair: generates P-256 key, triggers browser PEM file download, shows public key JWK on completion
- StepDidHosting: drag-and-drop certificate upload, domain display with localhost warning (per research pitfall 5), DID document Collapsible
- StepLrn: Select for VAT/LEI/EORI types, validation result display, LRN credential Collapsible
- StepLegalParticipant: legal name + ISO 3166-2 country code + private key upload, LP credential Collapsible
- StepTerms: Gaia-X T&C text in ScrollArea + private key upload + T&C credential Collapsible
- StepGxdchSubmit: three credential previews with raw JSON Collapsibles, 4-phase progress indicator (assembling/submitting/verifying/complete), retry on failure
- Wizard page at /compliance/wizard with SWR state loading, free navigation for completed steps, onComplete advances stepper and refreshes state

## Task Commits

Each task was committed atomically:

1. **Task 1: 9 proxy routes + WizardLayout + WizardStepper** - `94af5ff` (feat)
2. **Task 2: 6 step components + wizard page** - `1dc4da4` (feat)

## Files Created

**Proxy routes (9 files):**
- `web/src/app/api/compliance/wizard/route.ts` — GET /v1/gaia-x/wizard
- `web/src/app/api/compliance/wizard/keys/route.ts` — POST /v1/gaia-x/wizard/keys
- `web/src/app/api/compliance/wizard/certificate/route.ts` — POST /v1/gaia-x/wizard/certificate
- `web/src/app/api/compliance/wizard/lrn/route.ts` — POST /v1/gaia-x/wizard/lrn
- `web/src/app/api/compliance/wizard/legal-participant/route.ts` — POST /v1/gaia-x/wizard/legal-participant
- `web/src/app/api/compliance/wizard/terms/route.ts` — POST /v1/gaia-x/wizard/terms
- `web/src/app/api/compliance/wizard/submit/route.ts` — POST /v1/gaia-x/wizard/submit
- `web/src/app/api/compliance/status/route.ts` — GET /v1/gaia-x/compliance
- `web/src/app/api/compliance/rerun/route.ts` — POST /v1/gaia-x/compliance/rerun

**Layout components (2 files):**
- `web/src/components/compliance/wizard-layout.tsx` — WizardLayout with WizardStepDef type export
- `web/src/components/compliance/wizard-stepper.tsx` — WizardStepper with status icons + connector lines

**Step components (6 files):**
- `web/src/components/compliance/steps/step-key-pair.tsx`
- `web/src/components/compliance/steps/step-did-hosting.tsx`
- `web/src/components/compliance/steps/step-lrn.tsx`
- `web/src/components/compliance/steps/step-legal-participant.tsx`
- `web/src/components/compliance/steps/step-terms.tsx`
- `web/src/components/compliance/steps/step-gxdch-submit.tsx`

**Wizard page (1 file):**
- `web/src/app/(main)/compliance/wizard/page.tsx`

## Decisions Made

- **effectiveStep pattern:** The wizard page uses `currentStep` local state initialized to `null`, resolving to `wizardState.current_step ?? 0`. This avoids a flicker where the page would briefly show step 0 before the SWR data loads and overwrites to the backend-persisted step.
- **Free navigation:** `isStepCompleted()` checks specific `wizardState` fields per step index (public_key_jwk, did_document, lrn_credential, etc.). The `handleStepChange` callback only calls `setCurrentStep` when `isStepCompleted` returns true, preventing jumping to incomplete steps.
- **Submission retry:** `StepGxdchSubmit` shows "Retry Submission" when `phase === "error"`. On retry click, `handleSubmit` runs again and resets the phase to "assembling".

## Deviations from Plan

None - plan executed exactly as written. All components match the spec layout, all API endpoints are correctly wired, free navigation is implemented, and `npx next build` passes cleanly.

## Self-Check: PASSED

Verified all 18 files exist. Commits 94af5ff and 1dc4da4 verified in git log. `npx next build` passes with all 9 compliance API routes and `/compliance/wizard` page visible in output.

---
*Phase: 09-gaia-x-compliance-wizard*
*Completed: 2026-02-27*
