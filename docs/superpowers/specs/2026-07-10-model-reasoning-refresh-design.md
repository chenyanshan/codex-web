# Model And Reasoning Refresh Design

## Goal

Make model-dependent reasoning options update immediately, preserve explicit
user choices, honor the browser-local new-thread defaults, and keep model and
reasoning option names untranslated in every UI language.

## Context

Codex Web loads its model catalog from the local Codex app-server through
`GET /api/models`. Each model supplies its supported reasoning efforts. Current
Codex metadata for `gpt-5.6-sol` and `gpt-5.6-terra` can include `max` and
`ultra`; other models, including `gpt-5.6-luna`, may expose a smaller list.

The existing session model change handler updates application state and saves
session settings, but it does not render again. The reasoning select therefore
keeps the previous model's DOM options until an unrelated full render occurs.
This makes a switch from a model capped at `xhigh` to `gpt-5.6-sol` appear to
take a long time before `max` and `ultra` become available.

The New Thread settings are already stored in browser localStorage. They are
browser-local by design and do not need account-level or cross-machine sync.

## Decisions

### Session Model Changes

Changing the model in an existing session will:

1. Set the selected model in application state.
2. Normalize the current reasoning effort against the new model metadata.
3. Preserve the current effort when the new model still supports it. For
   example, switching from `gpt-5.4 + xhigh` to `gpt-5.6-sol` keeps `xhigh`
   selected.
4. Fall back to the new model's default effort only when the previous effort is
   unsupported.
5. Render immediately so the reasoning select contains the new model's complete
   option list in the same interaction.
6. Save the resulting model and effort through the existing asynchronous
   session settings request.

The model switch will not automatically select the strongest available effort.
Selecting `ultra` remains an explicit user decision unless it came from the
saved New Thread defaults.

### New Thread Defaults

The Settings page remains the source of browser-local defaults. When it stores:

```text
model: gpt-5.6-sol
reasoningEffort: ultra
```

every new draft and newly created session in that browser will start with
`gpt-5.6-sol + ultra`. Opening an existing session with explicit saved settings
will continue to use that session's settings instead.

Changing the default model will preserve the saved default reasoning effort if
the new model supports it. Otherwise it will use the selected model's declared
default effort, following the same normalization rule as session settings.

### Localization

Interface labels such as `Model` and `Reasoning` remain translatable. Dynamic
model names and reasoning option labels are provider-owned values and will not
be translated.

In both English and Chinese UI modes, representative values will render as:

```text
GPT-5.6-Sol
Low
Medium
High
xhigh
Max
Ultra
```

Reasoning labels may be formatted for English readability, but they must not be
passed through the UI translation dictionary. Both the global New Thread
controls and the active-session controls follow this rule.

### Model Metadata And Compatibility

Codex Web will continue to trust the local app-server model metadata. It will
not hardcode `ultra` for model names that do not advertise it. This prevents an
older or differently rolled-out Codex runtime from receiving an unsupported
reasoning value.

If model metadata is unavailable, the existing fallback list remains:

```text
low, medium, high, xhigh
```

The UI will not invent `max` or `ultra` while operating on fallback metadata.

## Upgrade Behavior

Pulling repository changes does not hot-reload the running backend process.
The macOS upgrade instructions will require:

```bash
git pull --ff-only
npm install
scripts/service/restart-codex-web-launchd-user.sh
```

After the restart, reopening or refreshing the PWA loads the updated client.
The documentation will also state that the selected model must advertise
`ultra` through the Codex CLI used by `CODEX_REAL_BIN`. Updating this repository
alone cannot add capabilities to an older Codex runtime.

## Error Handling

The existing session settings request remains asynchronous. The immediate
render reflects the locally selected settings without waiting for network
round-trip latency. Existing API error handling continues to surface a failed
save; this change does not add optimistic rollback.

Failure to load `/api/models` continues to use the fallback reasoning list. It
must not translate fallback option values or add unsupported options.

## Testing

Add focused regressions for:

- Changing an active session from an `xhigh`-only model to `gpt-5.6-sol`
  immediately renders `max` and `ultra` while keeping `xhigh` selected.
- A saved browser-local New Thread default of `gpt-5.6-sol + ultra` is used by
  draft state and the new-session request.
- Chinese localization translates the surrounding labels but leaves model
  names and reasoning option labels in English.
- The documented macOS upgrade flow includes dependency installation and a
  service restart.

Run the focused UI and documentation tests, the full workspace test suite, and
`npm run typecheck` before completion.

## Non-Goals

- Account-level or cross-machine synchronization of New Thread defaults.
- Automatically selecting `ultra` whenever a 5.6 model is chosen.
- Hardcoded reasoning capabilities based on model-name patterns.
- Automatic installation or upgrade of the Codex CLI.
