---
name: Landing Zone Release Brief
description: A restrained, readable interface for source-backed release comparisons.
colors:
  primary: "#1768d2"
  primary-hover: "#0f56b2"
  primary-active: "#104a97"
  page: "#f4f7fb"
  surface: "#ffffff"
  ink: "#192639"
  secondary-text: "#52647b"
  field-border: "#c5d0de"
  divider: "#cbd5e1"
  selected-surface: "#edf4fc"
  added: "#257048"
  added-surface: "#eff9f3"
  removed: "#a13c40"
  removed-surface: "#fff2f2"
  deprecated: "#795515"
  deprecated-surface: "#fff8e8"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(31px, 4vw, 42px)"
    fontWeight: 680
    lineHeight: 1.12
    letterSpacing: "-0.045em"
  headline:
    fontSize: "clamp(23px, 3vw, 30px)"
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  title:
    fontSize: "16px"
    fontWeight: 650
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    lineHeight: 1.5
  mobile-reading:
    fontSize: "16px"
  label:
    fontSize: "13px"
    fontWeight: 650
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11px"
rounded:
  badge: "3px"
  field: "5px"
  notice: "6px"
  form: "8px"
spacing:
  tight: "8px"
  related: "12px"
  control: "18px"
  section: "24px"
  report: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.field}"
    padding: "0 17px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    height: "44px"
  release-picker:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.field}"
    padding: "10px 16px"
  status-added:
    backgroundColor: "{colors.added-surface}"
    textColor: "{colors.added}"
    rounded: "{rounded.badge}"
    width: "32px"
    height: "32px"
  status-removed:
    backgroundColor: "{colors.removed-surface}"
    textColor: "{colors.removed}"
    rounded: "{rounded.badge}"
    width: "32px"
    height: "32px"
  status-deprecated:
    backgroundColor: "{colors.deprecated-surface}"
    textColor: "{colors.deprecated}"
    rounded: "{rounded.badge}"
    width: "32px"
    height: "32px"
---

# Design System: Landing Zone Release Brief

## Overview

**Creative North Star: "The Engineering Brief"**

The interface is calm, precise, and practical. Cool neutral surfaces frame
source-backed information; cobalt identifies actions and focus rather than
decorating the report. Hierarchy comes from type weight, spacing, and fine
dividers, not oversized statistics or ornamental containers.

This is a business tool. Favor clear navigation and dependable feedback over
spectacle. Preserve the compact desktop reading experience and give the same
content more room on phones. Motion acknowledges state changes without delaying
work or moving large areas of content.

The metaphor and descriptive palette names are inferred documentation labels,
not a user-approved rebrand. Measurements below are extracted from
`src/routes/+page.svelte` and `src/routes/+layout.svelte`; they describe the
incumbent implementation, not a new theme or shared CSS-token layer.

**Key Characteristics:**
- Restrained cobalt action color over cool paper and white.
- System typography with clear weight-based hierarchy.
- Flat, divided report rows with native disclosure.
- Touch-ready controls and full-width mobile reading.
- Short, purposeful feedback with static reduced-motion states.

## Colors

A cool, low-noise palette lets policy changes carry the visual weight.
The sidecar's tonal ramps are synthesized preview aids, not implemented color
scales. Its component snippets are standalone representations of the source
patterns, not a new component library.

### Primary

- **Action Cobalt** (`primary`): primary actions, brand mark, keyboard focus,
  and release-selection cues.
- **Pressed Cobalt** (`primary-hover`, `primary-active`): darker control feedback,
  never an extra decorative accent.

### Neutral

- **Cool Paper** (`page`): the page canvas.
- **White Surface** (`surface`): navigation, comparison controls, and report rows.
- **Engineering Ink** (`ink`): default readable text.
- **Slate Annotation** (`secondary-text`): explanatory text and metadata.
- **Field Stroke** (`field-border`): input boundaries.
- **Report Divider** (`divider`): major report boundaries.
- **Inspection Wash** (`selected-surface`): open disclosure headers and notices.

Semantic greens, reds, and amber distinguish added, removed, and deprecated
states. Their pale companion surfaces keep badges quiet. Updated items use the
neutral badge treatment. These are status roles, not additional brand accents.

**The Accessible Status Rule.** Color never carries status alone: retain the
distinct icon, screen-reader label, and native hover description, including a
separate deprecation indicator when applicable.

## Typography

System sans-serif carries headings, controls, and prose. System monospace is
reserved for literal release tags and code, not a general technical aesthetic.
The frontmatter records the desktop baseline; responsive overrides remain part
of the system.

### Hierarchy

- **Display:** the main heading uses fluid size, tight leading, and medium-heavy
  weight. On phones it uses (32px).
- **Report heading:** the compared versions remain a screen-reader-only heading;
  visible versions are already present in the release pickers.
- **Title:** policy names use the title role on desktop and mobile reading size
  on phones. Long names wrap rather than truncate.
- **Body:** the page baseline uses the body role. Desktop report detail uses
  (13px), summary annotations (12px), and mobile reading text (16px).
- **Label:** field labels have semibold emphasis. Status indicators are
  icon-only with screen-reader labels.
- **Data:** full release tags are accessible descriptions of their selectors;
  visible release versions use (20px) semibold type.

The title and introductory prose are centered. Prose has a (620px) maximum
width. Matching gaps above the introduction and below it separate navigation,
introduction, and release controls: (48px) desktop, (40px) tablet, (32px) phone.
Do not turn this observed measure into an invented global
width rule for every report row.

## Layout

The central container is capped at (1180px), including its padding. Desktop
gutters are (28px), with (56px) above the introduction. Navigation is (64px)
high. The comparison form aligns two flexible release fields around a direction
connector and the primary action.

At (900px) and below, the action moves to its own row, introduction and report
controls stack, and version columns become narrower. At (650px) and below,
gutters become (18px), release fields stack, and the compare action fills the
form width. Search is the only report-filtering control and spans the control
area on compact layouts; there are no item-type or change-type selectors.

Mobile report rows place status and version above a full-width title and
summary. Expanded details lose their desktop indentation. Safe-area insets
protect content in portrait and landscape. All report content and functionality
remain available at narrow widths.

**The Reading First Rule.** When space tightens, reflow metadata around the
policy title rather than narrowing the title into a side column.

## Elevation & Depth

Depth is tonal and structural: white surfaces, cool page background,
and thin borders. The comparison bar has no enclosing card or shadow.
Focus uses a clear outline; the search field also
has a small state halo. These are interaction cues, not elevated card styling.

## Shapes

Corners are gently squared: small badges and modest field radii.
Report rows are flat and square, separated by fine
horizontal rules. Complete reports have no success badge; incomplete source
coverage receives an explicit warning with the report's explanation.

There are no report or page footers or separate introductory scope badge.
The header links to this app's GitHub repository; report
source links, and inline interpretation notes provide context without
repeating explanatory copy after the results.

## Components

### Buttons

The primary action is compact and confident. It has a minimum hit height (44px),
white text, cobalt fill, and darker hover/pressed states. Disabled actions use
a muted blue-gray surface and an appropriate cursor. Secondary actions are
underlined text, not competing filled buttons.

Background and border transitions take (120ms). Buttons do not lift, bounce, or
require animation to explain their state.

### Inputs / Fields

Native selects and search retain white surfaces, thin strokes, and modest
corners. Release pickers frame their label and version together with a
slate boundary (`#708198`); native selects retain keyboard behavior with a
custom, non-interactive chevron. Hit areas are at least (44px) high.
Search uses (16px) type on phones; selected release values remain (20px).
Keyboard focus is a cobalt outline (3px) offset by (2px); do not remove it.
Disabled release selectors remain visibly distinct.

### Navigation

A white top bar pairs the Landing Zone Release Brief name and a cobalt two-release
comparison mark with the app's GitHub
repository link. Both links have (44px) minimum hit height. On phones, the
repository name may ellipsize; the destination remains available. A skip link
appears on keyboard focus. The (28px) comparison mark also serves as the browser
favicon. The name describes the human-readable report rather than a raw diff;
it was selected autonomously when the user was unavailable for naming review.

### Status Badges

Status symbols are (20px), without backgrounds or borders: blue for updated,
green for added, red for removed, and orange for deprecated. Multiple symbols
sit side by side, never stacked. Each includes a screen-reader label and native
title description. Icons are informational, not clickable filters.
Deprecation can coexist with an update and must not be conflated with removal.
Deprecation-only definition changes show the orange icon alone, not an update
icon. This is determined from source content, not just a version suffix;
substantive definition changes retain both indicators.

Expanded items lead with the change outcome rather than the policy description.
Assignment deltas show labeled before/after values and name unchanged settings,
so an initiative replacement is not mistaken for a policy-rule change. Full
assignment evidence remains available below the concise explanation.

### Comparison Form

An ALZ/SLZ segmented radio group sits centered above the release pickers. Its
selected segment uses Action Cobalt and white text; the other uses Slate
Annotation over Inspection Wash. Each segment has a (44px) minimum hit height,
and keyboard focus remains visible. The control stays compact on phones and
is disabled while a comparison is being prepared.

Both pickers show only the selected library. Switching clears the report and
restores that library's last selected pair; the first selection uses the newest
two releases. The description expands ALZ as Azure Landing Zones and SLZ as
Sovereign Landing Zone. The heading and browser title reflect the selected
library while the Landing Zone Release Brief brand covers both libraries.

Two individually framed release pickers surround a simple direction arrow.
Sentence-case labels sit beside versions inside compact (54px) pickers; full
tag paths remain accessible descriptions rather than duplicated visible
metadata. The primary action stretches to match the pickers' height on desktop,
moves below at (52px) high on tablets, and spans the width beneath stacked
pickers on phones.
The enclosing grid has no background, border, shadow, or padding.
Compared tags persist in the URL so refresh restores the report automatically.
The library also persists in the URL; links without it infer their library from
the tags. SLZ reports include a quiet explanatory paragraph about pinned ALZ
dependencies and inherited changes above the report controls.

### Report Disclosures

The report begins with one compact, borderless metadata block combining
change totals and generation time. It wraps on smaller screens and leads
directly into the searchable changes; redundant summary and context prose
are omitted.
Policy titles use (16px) throughout. Actual version transitions receive
semibold ink emphasis, while unchanged versions remain secondary.
These amplify the existing type hierarchy without new colors or motion.

Native details/summary rows expose version, title, and a concise explanation
before expansion. Open headers receive Inspection Wash; the chevron turns over
(160ms) with natural deceleration. Assignment detail renders on demand. Open
items remain open across filtering; a new comparison resets them.

There are no report-header animations, scroll reveals, delayed
row entrances, or decorative loops. The essential request spinner remains;
reduced-motion preferences stop it and disable authored transitions.

## Do's and Don'ts

### Do:
- Do use color for action, focus, and explicitly labeled status.
- Do retain native keyboard disclosure and visible focus.
- Do let long policy names, descriptions, and source links wrap.
- Do preserve full report functionality on phones.
- Do keep routine feedback short and reduced-motion states static.

### Don't:
- Don't add spectacle or page-load choreography to this business tool.
- Don't replace the flat report list with decorative nested cards.
- Don't use status color without its distinct icon and accessible text label.
- Don't use monospace for ordinary explanations.
- Don't hide source evidence or assignment context to make a layout fit.
