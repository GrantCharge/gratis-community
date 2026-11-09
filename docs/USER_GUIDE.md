# Using Gratis

## Assistants and groups

Each bot has instructions, a model choice, tool capabilities, a file workspace and its own conversation context. A group's first bot is the coordinator. It answers simple requests itself, assigns useful subtasks, and adds a short synthesis after a teammate's findings. Direct mentions reach their recipients without an extra coordinator reply.

Use the bot menu to edit, pin, duplicate or delete a bot. A group menu manages its name and participants. Deleting a group removes its local chat; it does not delete an independent T3 task. Stop remote work separately.

## Memory

Memory has three scopes: your profile across permitted bots, one bot across its chats, and one conversation. Open Memory to inspect, correct, confirm or forget entries. Permanent facts should come from what you actually said; uncertain inferences remain proposals. Retrieved memories are context, not authorization for external actions.

## Files and responses

Attach files from the + menu. Generated files appear in Files. Markdown responses support headings, lists, tables, links and code blocks. Copy the full reply or an individual code block. PDF extraction additionally requires Poppler's `pdftotext` on PATH.

## Scheduled tasks

Use an explicit instruction with a frequency, time and timezone. Daily, weekdays, a selected weekly day and intervals from 15 minutes are supported. A task runs through the same bot and tool permissions, and posts in the originating chat.

The app must be running and the computer awake. Closing its window leaves enabled schedules running; quitting does not. Missed intervals coalesce into one fresh run. Busy chats defer scheduled work. Failed or interrupted runs pause for review rather than blindly repeating an uncertain action. A timer cannot authorize unrelated purchases, messages or deletions.

## Custom AI providers

Besides Claude and Codex, Settings → **AI subscription** → **Custom provider** connects any OpenAI-compatible API that uses an address and an API key, such as FreeLLMAPI, Command Code (`https://api.commandcode.ai/provider/v1`) or DeepSeek (`https://api.deepseek.com/v1`). Open **Manage custom providers**, pick a preset or type the address, paste a key and choose **Add provider**. Gratis loads the provider's model list; routing aliases such as FreeLLMAPI's `auto:default` appear first.

Addresses must use HTTPS, or HTTP on this computer only. Keys are encrypted with the operating system's secure storage, are sent only to that provider and are never shown again; to replace one, remove the provider and add it again. Custom models chat only: they cannot use connected apps, files, memory tools or the cloud computer. The model applies to the whole workspace and can be changed from the chat header. Choosing a custom model from the phone is not supported yet.

## Connected apps

Composio sign-in and per-service authorization are optional. You can disconnect or change credentials in Settings. Review the permissions requested by each service. A bot can only use integrations exposed by its enabled runtime.

## Computer and takeover

With your own cloud backend configured, the Computer pane shows the bot's browser. Drag the divider to resize it, or expand it. Take control to use its mouse and keyboard; Give control back resumes unfinished work from a fresh view of the page. Save important files before stopping the computer. This computer is separate from the Mac running Gratis.

## T3 project tasks

Connect an existing T3 MCP environment by address in Tasks. Gratis does not replace or install a system T3 service in this edition. Authorize access in T3, choose a project and model, and start a bounded task. Follow-up messages reuse the saved thread. The execution host must remain available; project credentials and permissions belong to that environment. T3 does not automatically inherit Composio connections from Gratis.

## What to verify

Check sources, files and final outcomes. A tool error is not a completed action. Neither provider access nor automation makes every website or workflow reliable. Use a small reversible task first when setting up a new connection.
