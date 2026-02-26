# Codebase Concerns

**Analysis Date:** 2026-02-26

## Tech Debt

**Type Safety in Complex Components:**
- Issue: Multiple components use `any` type escapes for external libraries without proper typing
- Files: `src/components/force-graph.tsx`, `src/components/chart-widget.tsx`, `src/lib/graph-rendering.ts`
- Impact: Reduces IDE support, increases risk of runtime errors in graph rendering and charting logic; difficult to maintain/refactor
- Fix approach: Create proper TypeScript interfaces for react-force-graph-2d and recharts node/link types, extract drawing functions with concrete types

**API Proxy Error Handling Incomplete:**
- Issue: The API proxy in `src/lib/api-proxy.ts` has a generic catch block that only returns 502 errors; actual errors from response parsing are not caught
- Files: `src/lib/api-proxy.ts` (lines 28-32)
- Impact: Network or serialization errors during API calls will silently fail with generic messages, making debugging difficult
- Fix approach: Add specific catch handlers for different error types (network errors, JSON parse failures), include error context in logs

**Missing Environment Variable Validation:**
- Issue: `KEASY_API_URL` and `KEASY_API_KEY` have default/fallback values in `src/lib/api-proxy.ts` with no validation that they're properly configured
- Files: `src/lib/api-proxy.ts` (lines 1-2)
- Impact: Empty API key will silently fail requests; wrong API URL will cause confusing 502 errors instead of clear configuration errors
- Fix approach: Add startup validation that warns/errors if critical env vars are missing, particularly before server start

**Untyped State Management:**
- Issue: Components like `src/components/discovery-ask.tsx` manage complex state (conversations, messages, loading states) with useState without proper interfaces or a state machine
- Files: `src/components/discovery-ask.tsx` (lines 143-151), `src/app/(main)/(data)/connections/new/page.tsx` (lines 59-66)
- Impact: State transitions are implicit and easy to get wrong; refactoring is risky; edge cases (e.g., loading while deleting) are not handled consistently
- Fix approach: Create explicit state interfaces or use a reducer pattern for complex state logic

**Incomplete Error Handling in Dialog Operations:**
- Issue: Component error handlers in `src/components/discovery-ask.tsx` (line 225) silently swallow errors without logging or user notification
- Files: `src/components/discovery-ask.tsx` (line 224-225)
- Impact: Users don't see errors when delete operations fail; backend issues go undetected
- Fix approach: Add toast notifications for all failed operations, use consistent error handling pattern

---

## Known Bugs

**Silent Failures on Delete Operations:**
- Symptoms: User deletes a conversation, but if the API call fails, the UI still shows deletion
- Files: `src/components/discovery-ask.tsx` (lines 216-226)
- Trigger: Network failure or server error during delete conversation request
- Workaround: Refresh page to restore deleted conversation state
- Root cause: Missing error handling in delete flow allows stale UI state

**Request Body Lost in API Proxy:**
- Symptoms: PUT/PATCH requests might lose body content
- Files: `src/lib/api-proxy.ts` (line 25)
- Trigger: Sending text body through proxy to backend
- Details: Body is read as text but may not be properly forwarded for all content types
- Fix: Ensure content-type headers are properly forwarded and body is streamed correctly

---

## Performance Bottlenecks

**Large Graph Rendering Performance:**
- Problem: Force graph component renders with canvas-based drawing that may not scale well to thousands of nodes
- Files: `src/components/force-graph.tsx`, `src/lib/graph-rendering.ts`
- Cause: Full node/link redraw on every render cycle; no virtualization for large datasets
- Current mitigations: ResizeObserver for responsive sizing, canvas-based rendering instead of DOM
- Improvement path: Implement culling to skip rendering off-screen nodes; add configurable max visible nodes; profile render times with large datasets

**Chart Widget Re-renders:**
- Problem: `src/components/chart-widget.tsx` (673 lines) re-renders entire chart when data changes
- Files: `src/components/chart-widget.tsx`
- Cause: No memoization at component level; Recharts library rerenders on all prop changes
- Improvement path: Wrap chart series components with React.memo; memoize data transformation functions; consider using react-big-calendar patterns for large datasets

**Sidebar Layout Complexity:**
- Problem: `src/components/ui/sidebar.tsx` (726 lines) manages multiple state variables (open, openMobile, isMobile) with complex useEffect dependencies
- Files: `src/components/ui/sidebar.tsx` (lines 69-100+)
- Cause: Cookie synchronization, mobile/desktop state management, keyboard shortcuts all in one component
- Improvement path: Split keyboard shortcut logic to custom hook; memoize context value; extract cookie handling to separate utility

**Missing Pagination:**
- Problem: All list endpoints (jobs, connections, conversations) return unlimited data
- Files: Multiple API routes in `src/app/api/`
- Impact: Large deployments will load all records into memory
- Improvement path: Implement cursor-based or offset pagination in API; update SWR hooks to handle pagination

---

## Fragile Areas

**Discovery Ask Component (427 lines):**
- Files: `src/components/discovery-ask.tsx`
- Why fragile: Multiple async state flows (conversation creation, message fetching, message sending), mixed loading states, error handling paths that don't rollback UI changes
- Safe modification: Add explicit state machine (draft -> loading -> done/error); add comprehensive error tests; separate message rendering from message logic
- Test coverage: No test files found for this critical feature
- Risk: Changes to message flow, provider selection, or conversation lifecycle are difficult and error-prone

**Chart Widget Component (673 lines):**
- Files: `src/components/chart-widget.tsx`
- Why fragile: Complex rule-based rendering logic (interface ChartRule with render functions); many type escapes (any); tight coupling to Recharts internals
- Safe modification: Extract chart type detection logic to pure functions; create typed wrappers for Recharts components; add unit tests for each chart type
- Test coverage: None found
- Risk: Adding new chart types or modifying existing rendering rules can break existing visualizations

**Sidebar Component (726 lines):**
- Files: `src/components/ui/sidebar.tsx`
- Why fragile: Multiple interdependent state variables (open, openMobile, isMobile); cookie and keyboard event listeners; ResizeObserver usage
- Safe modification: Extract ResizeObserver logic to custom hook; move keyboard listener to separate hook; use useReducer for state management
- Test coverage: None found
- Risk: Changes to mobile behavior, expand/collapse logic, or keyboard shortcuts require careful testing across breakpoints

**API Proxy Handler:**
- Files: `src/lib/api-proxy.ts`
- Why fragile: Generic error handling without specific error types; body passed as text may not work with all content types; header forwarding is selective
- Safe modification: Add integration tests for PUT/PATCH with various payloads; test error scenarios; add logging
- Test coverage: None found
- Risk: Adding new endpoint types (FormData, binary) or fixing header issues requires careful debugging

---

## Security Considerations

**API Key Exposure Risk:**
- Risk: `KEASY_API_KEY` environment variable is used client-side via `src/lib/api-proxy.ts` on server routes
- Files: `src/lib/api-proxy.ts` (line 2)
- Current mitigation: Key is used in server functions only, not exposed to browser
- Recommendations: Verify no accidental exposure in Next.js logs; add env validation at startup; consider using Next.js middleware to validate API key presence before accepting requests

**Missing CORS/CSRF Protection:**
- Risk: API proxy forwards requests to backend without validating origin or adding CSRF tokens
- Files: `src/lib/api-proxy.ts`
- Current mitigation: Relies on backend CORS/auth validation
- Recommendations: Add CSRF token middleware; validate Origin header; ensure backend enforces authentication on all mutation endpoints

**User Input in Graph Queries:**
- Risk: Search queries in `src/components/discovery-explorer.tsx` are sent directly to backend API
- Files: `src/components/discovery-explorer.tsx`, `src/lib/api.ts` (searchGraphNodes function)
- Current mitigation: Relies on backend input validation/sanitization
- Recommendations: Add client-side input validation; sanitize user queries before sending; add rate limiting for search requests

---

## Scaling Limits

**Unlimited List Rendering:**
- Current capacity: UI loads all jobs, connections, conversations into state
- Limit: Performance degrades with >1000 records
- Impact: Memory usage grows linearly; renders become slow
- Scaling path: Implement virtual scrolling (react-window); add pagination to list endpoints; implement cursor-based loading in client

**Graph Data Size Limits:**
- Current capacity: Graph component renders all nodes/links on canvas
- Limit: 10,000+ nodes will cause frame drops
- Impact: Discovery and knowledge graph views become unusable with large datasets
- Scaling path: Add graph filtering/search; implement virtual rendering; add LOD (level of detail) for zoomed out views

**No Request Debouncing:**
- Current capacity: Unlimited API requests from autocomplete and search
- Limit: Rapid typing triggers many backend calls
- Impact: Backend load spikes; network congestion
- Scaling path: Add debouncing to code editor completion (already done in `src/components/code-editor.tsx`); apply same to graph search in `src/components/discovery-explorer.tsx`

---

## Dependencies at Risk

**react-force-graph-2d:**
- Risk: Unmaintained third-party library (last update 2024); heavy canvas manipulation; incompatible with React 19's concurrent features
- Files: `src/components/force-graph.tsx` (import dynamic)
- Impact: May break with future React versions; performance issues with concurrent rendering
- Migration plan: Consider alternatives like xyflow (already in dependencies), Cytoscape.js, or D3.js with proper React bindings

**CodeMirror 6:**
- Risk: Complex API; documentation gaps; many extensions required for basic features
- Files: `src/components/code-editor.tsx`
- Impact: Customizations are fragile; upgrades require careful testing
- Migration plan: Already implemented as custom wrapper; easier to replace if needed

**Recharts:**
- Risk: Type safety issues (requires many type escapes); no TypeScript definitions for advanced features
- Files: `src/components/chart-widget.tsx`
- Impact: Chart rendering bugs are hard to debug; adding new chart types is tedious
- Migration plan: Monitor for better typed charting libraries; consider visx or Tremor as alternatives

---

## Missing Critical Features

**No Offline Support:**
- Problem: Application requires constant backend connectivity; no local caching
- Blocks: Using the app in environments with intermittent connectivity
- Workaround: None; page refresh required if connection drops
- Priority: Medium - accept for MVP but plan for future

**No Request Retry Logic:**
- Problem: Failed API requests fail immediately without retry
- Files: `src/lib/api.ts` (request function)
- Blocks: Resilience in poor network conditions
- Workaround: Manual page refresh
- Priority: Medium - affects UX on unreliable networks

**No Optimistic Updates:**
- Problem: State changes wait for server confirmation, causing perceived lag
- Files: Multiple components using SWR
- Blocks: Responsive UI feel, especially on slow networks
- Workaround: None; users see delay
- Priority: Low-Medium - affects perception but not functionality

---

## Test Coverage Gaps

**No Unit Tests for API Layer:**
- What's not tested: Error handling, request formatting, response parsing
- Files: `src/lib/api.ts`, `src/lib/api-proxy.ts`
- Risk: Breaking changes to API contracts go undetected; error handling bugs escape to production
- Priority: High - critical path code

**No Tests for Complex Components:**
- What's not tested: Discovery Ask flow, Chart Widget rendering, Sidebar interactions, Code Editor completions
- Files: `src/components/discovery-ask.tsx`, `src/components/chart-widget.tsx`, `src/components/ui/sidebar.tsx`, `src/components/code-editor.tsx`
- Risk: Refactoring or feature changes risk breaking UX
- Priority: High - largest and most fragile components

**No Integration Tests for Full Workflows:**
- What's not tested: Create connection → Create job → Run discovery → Ask question flow
- Risk: Multi-component interactions break silently; regressions take time to discover
- Priority: Medium - important but less frequent than unit test gaps

**No E2E Tests:**
- Current status: No Playwright/Cypress configuration found
- Risk: UI-level bugs (layout, responsive design, accessibility) only found by manual testing
- Priority: Medium-High for production readiness

---

*Concerns audit: 2026-02-26*
