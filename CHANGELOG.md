# Changelog

## Unreleased

- Publish version tags through GitHub Actions with Marketplace OIDC authentication, after version validation, type checking, and tests.
- Configure the AI endpoint, model, and API key together in native User Settings, opened from AI Provider selection and authentication errors.
- Replace SecretStorage and the separate Set API Key command with the plain-text, user-level translationReview.apiKey setting. Previously saved secrets are not read or migrated.
- Use a transparent double-eye extension icon with the left blue eye mirrored toward the right red eye. Keep single-eye toolbar icons blue while disabled and red while enabled, with increased opacity and unchanged detail.
- Render toolbar eyes as opaque SVG paths traced from the original artwork, with separate light-theme and dark-theme colors. Keep the double-eye extension icon unchanged.
- Enable automatic translation by default when a window starts. Opening a Markdown preview translates through the selected provider without a toggle click; manual disabling lasts until the window reloads.
- Add the user-level `translationReview.automatic` checkbox, checked by default, to choose the automatic translation state at window startup. Changing it requires a window reload; the eye button remains a session-only toggle.
- Skip paragraphs locally when their dominant language confidently matches the target, for both AI and Google translation. Apply the same rule across detection languages, allowing embedded foreign terms without script restrictions. Keep uncertain text eligible for translation, distinguish Simplified and Traditional Chinese, and leave skipped paragraphs unchanged.
- Clear cached translations and restore original Markdown previews when translation is disabled. Cancel unfinished requests and translate afresh when enabled again.
- Show only English language names in the target-language picker, without codes or alias descriptions.
- Use reliable document language context for ambiguous headings and technical prose, without overriding reliably detected foreign languages or required Simplified/Traditional Chinese conversions.
- Suppress unchanged translations consistently across Markdown and native frontmatter while retaining completed results in the cache.

## 0.5.0

- Rename the extension to MarkDown Preview Translate and prepare the Roland.markdown-preview-translate package for the VS Code Marketplace.
- Use English for commands, status-bar tooltips, language names, prompts, progress notifications, and error messages.
- Replace the README with an English usage guide.
- Keep existing setting and command identifiers, target-language aliases, and translation behavior.

## 0.4.0

- Turn the preview translation action into a window-session automatic translation toggle, with a globe when disabled and an eye when enabled.
- Translate the active native Markdown preview after link navigation, including links between files sharing the same basename.
- Reuse completed paragraph translations, stop outstanding work on disable, and reject late responses while preserving completed output.
- Keep automatic mode off after window reload and restart current-preview translation after document or translation-setting changes while enabled.

## 0.3.1

- Combine translation controls into one status-bar item displaying the target language name. Click it to select a language, or hover and click the source link to change providers.
- Restore the custom-language picker identifier so AI custom language selection compiles and works.

## 0.3.0

- Add Google free online translation alongside the existing AI endpoint, without sharing AI credentials or falling back between providers.
- Add native status-bar source and target-language pickers with searchable language names and codes.
- Preserve local code and formatting markers in free mode, bound Unicode-safe requests, and cancel outstanding work on provider changes.
- Use user-level target language settings so workspace overrides cannot mask language picker choices.

## 0.2.6

- Translate short documents in one ID-based batch request instead of one request per paragraph.
- Pack longer documents into size-bounded batches with up to three concurrent requests.
- Validate complete batch IDs and protected formatting before publishing; refresh the preview once per completed batch.
- Stop pending work on cancellation or failure, preserving completed batches without publishing late responses.

## 0.2.5

- Place short translations beside the original heading, label, list item, or table value.
- Keep long text and multiline translations below the original, preserving native formatting and link targets.

## 0.2.4

- Translate text keys, scalar values, and list items inside native frontmatter tables.
- Preserve heading levels, emphasis, strikethrough, line breaks, and clickable link targets in translations.
- Keep completed translations stable when native renderers annotate cached tokens.
- Exclude translated blocks from native source-line mappings while preserving their styling.

## 0.2.3

- Ignore repeated clicks while a translation is running.
- Reject altered inline-code markers with a visible error instead of reporting a missing translation as complete.

## 0.2.2

- Keep inline code in its original form below translations without sending code content to the translation service.
- Leave prose paragraphs with inline math untranslated so their formulas stay with the original English.

## 0.2.1

- Translate English prose in the built-in Markdown Preview while preserving existing images, SVG, diagrams, math, code, links, and renderer extensions.
- Add a translation icon to the native preview title bar and bind translations to document versions and paragraph occurrences.

## 0.2.0

- Replace the separate custom editor with bilingual blocks in the built-in Markdown Preview.

## 0.1.0

- Add an optional translation review custom editor for Markdown and text files.
- Translate through a configurable OpenAI-compatible endpoint without changing the source file.
