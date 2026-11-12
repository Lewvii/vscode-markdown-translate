# MarkDown Preview Translate

Translate English Markdown text in VS Code's built-in Markdown preview without changing the source file. Use Google Translate or an OpenAI-compatible AI provider.

## Install

Use VS Code 1.95 or later. Install **MarkDown Preview Translate** from the Extensions view, or run **Extensions: Install from VSIX...** to install a downloaded `.vsix` file.

If you used the earlier local **Translation Review** or **MarkDown Translate** extension, disable or uninstall it before enabling MarkDown Preview Translate. Existing endpoint, model, and language settings still apply. Keys saved by earlier versions in SecretStorage are no longer read or migrated. Enter your key in **Translation Review: Api Key** in User Settings.

## Choose a translation source

1. Open a Markdown file in a trusted workspace.
2. Hover over the target language in the status bar.
3. Click **Change translation source**.
4. Select **AI Provider** or **Google Translate**.

AI is selected by default. Choosing **AI Provider** opens the extension's native User Settings so you can configure the endpoint, model, and API key together. The extension does not switch providers automatically when a request fails.

### Use Google Translate

Select **Google Translate** to translate without an API key. No AI configuration is needed.

This option sends text to Google's unofficial online translation endpoint. Availability and rate limits are not guaranteed. Do not use it for content you cannot share with Google.

### Use an AI provider

1. Run **MarkDown Preview Translate: Configure AI Provider**, or select **AI Provider** from the translation source picker.
2. In User Settings, enter the complete Chat Completions **Endpoint**, **Model**, and **Api Key**. Leave the key blank if the service does not require authentication.

You can also edit these values in **Preferences: Open User Settings (JSON)**:

   ```json
   {
     "translationReview.source": "ai",
     "translationReview.endpoint": "https://api.openai.com/v1/chat/completions",
     "translationReview.model": "gpt-4o-mini",
     "translationReview.apiKey": "",
     "translationReview.targetLanguage": "zh-CN"
   }
   ```

The API key is stored as plain text in your user settings, alongside the endpoint and model. Do not share or commit settings containing a key. Settings Sync may copy it to your other installations unless you exclude it. Update or clear the key when you change providers; keys are no longer stored separately per endpoint.

Google Translate does not use the configured API key. Remote endpoints require HTTPS; local loopback endpoints may use HTTP.

## Choose a target language

Click the language name in the status bar, or run **MarkDown Preview Translate: Select Target Language**. Search by language name or code, then select a language.

The default target is **Chinese (Simplified)** (`zh-CN`). Language choices and provider settings are saved at the user level. AI providers also accept a **Custom language** name; Google Translate requires a supported language from the list.

## Start and stop automatic translation

1. Open a Markdown file and run **Markdown: Open Preview**, or choose the built-in **Markdown Preview** editor.
2. Click the **globe** icon in the preview title bar to enable automatic translation.
3. Follow Markdown links as usual. The active preview continues translating after navigation.
4. Click the **eye** icon to disable automatic translation and restore the globe icon.

Automatic translation is off when a window starts. Once enabled, it stays on for that window until you disable it or reload the window. Editing the current document or changing translation settings clears outdated translations and translates the current preview again.

Disabling cancels unfinished requests and keeps completed translations visible. Returning to a document with cached translations does not resend completed paragraphs. Translations are kept in memory and are lost when the window reloads.

## Read translated content

Short translations appear beside the original text. Longer translations appear below it. Headings, lists, tables, emphasis, and links retain their formatting and link targets.

Images, diagrams, code blocks, and inline code stay in the native preview. Code and image content are not sent for translation. Paragraphs containing inline math are left unchanged. Translation processes document text, not just the visible screen.

For a dynamic preview, the extension may briefly open its source tab to identify the exact document, then return to the preview.

## Handle a failed or cancelled request

Check the reported error, network connection, provider settings, and any service limits. For AI authentication errors, click **Configure AI Provider** in the error notification to open the same User Settings. Updating the API key invalidates cached translations. If automatic translation is enabled, return to the Markdown preview to translate with the updated configuration.

To retry unfinished paragraphs, turn automatic translation off and on. The extension does not retry failed requests automatically and retains completed results when possible.

Translation sends document text to the selected service while automatic translation is enabled. AI services may charge for requests. Cancelling local work does not guarantee that the provider stops processing or billing the request.
