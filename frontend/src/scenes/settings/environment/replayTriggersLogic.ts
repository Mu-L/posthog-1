import { actions, connect, kea, listeners, path, reducers, selectors, sharedListeners } from 'kea'
import { forms } from 'kea-forms'
import { subscriptions } from 'kea-subscriptions'
import { teamLogic } from 'scenes/teamLogic'

import { SessionReplayUrlTriggerConfig, TeamPublicType, TeamType } from '~/types'

import type { replayTriggersLogicType } from './replayTriggersLogicType'

const NEW_URL_TRIGGER = { url: '', matching: 'regex' }

export function isStringWithLength(x: unknown): x is string {
    return typeof x === 'string' && x.trim() !== ''
}

function ensureAnchored(url: string): string {
    url = url.startsWith('^') ? url.substring(1) : url
    url = url.endsWith('$') ? url.substring(0, url.length - 1) : url
    return `^${url}$`
}

export const replayTriggersLogic = kea<replayTriggersLogicType>([
    path(['scenes', 'settings', 'project', 'replayTriggersLogic']),
    actions({
        setUrlTriggerConfig: (urlTriggerConfig: SessionReplayUrlTriggerConfig[]) => ({ urlTriggerConfig }),
        addUrlTrigger: (urlTriggerConfig: SessionReplayUrlTriggerConfig) => ({ urlTriggerConfig }),
        removeUrlTrigger: (index: number) => ({ index }),
        updateUrlTrigger: (index: number, urlTriggerConfig: SessionReplayUrlTriggerConfig) => ({
            index,
            urlTriggerConfig,
        }),
        setEditUrlTriggerIndex: (originalIndex: number | null) => ({ originalIndex }),
        newUrlTrigger: true,
        cancelProposingUrlTrigger: true,

        setUrlBlocklistConfig: (urlBlocklistConfig: SessionReplayUrlTriggerConfig[]) => ({ urlBlocklistConfig }),
        addUrlBlocklist: (urlBlocklistConfig: SessionReplayUrlTriggerConfig) => ({ urlBlocklistConfig }),
        removeUrlBlocklist: (index: number) => ({ index }),
        updateUrlBlocklist: (index: number, urlBlocklistConfig: SessionReplayUrlTriggerConfig) => ({
            index,
            urlBlocklistConfig,
        }),
        setEditUrlBlocklistIndex: (originalIndex: number | null) => ({ originalIndex }),
        newUrlBlocklist: true,
        cancelProposingUrlBlocklist: true,
        setEventTriggerConfig: (eventTriggerConfig: string[]) => ({ eventTriggerConfig }),
        updateEventTriggerConfig: (eventTriggerConfig: string[]) => ({ eventTriggerConfig }),
    }),
    connect(() => ({ values: [teamLogic, ['currentTeam']], actions: [teamLogic, ['updateCurrentTeam']] })),
    reducers({
        urlTriggerConfig: [
            null as SessionReplayUrlTriggerConfig[] | null,
            {
                setUrlTriggerConfig: (_, { urlTriggerConfig }) => urlTriggerConfig,
                addUrlTrigger: (state, { urlTriggerConfig }) => [...(state ?? []), urlTriggerConfig],
                updateUrlTrigger: (state, { index, urlTriggerConfig: newUrlTriggerConfig }) =>
                    (state ?? []).map((triggerConfig, i) => (i === index ? newUrlTriggerConfig : triggerConfig)),
                removeUrlTrigger: (state, { index }) => {
                    return (state ?? []).filter((_, i) => i !== index)
                },
            },
        ],
        editUrlTriggerIndex: [
            null as number | null,
            {
                setEditUrlTriggerIndex: (_, { originalIndex }) => originalIndex,
                removeUrlTrigger: (editUrlTriggerIndex, { index }) =>
                    editUrlTriggerIndex && index < editUrlTriggerIndex
                        ? editUrlTriggerIndex - 1
                        : index === editUrlTriggerIndex
                        ? null
                        : editUrlTriggerIndex,
                newUrlTrigger: () => -1,
                updateUrlTrigger: () => null,
                addUrlTrigger: () => null,
                cancelProposingUrlTrigger: () => null,
            },
        ],
        urlBlocklistConfig: [
            null as SessionReplayUrlTriggerConfig[] | null,
            {
                setUrlBlocklistConfig: (_, { urlBlocklistConfig }) => urlBlocklistConfig,
                addUrlBlocklist: (state, { urlBlocklistConfig }) => [...(state ?? []), urlBlocklistConfig],
                updateUrlBlocklist: (state, { index, urlBlocklistConfig: newUrlBlocklistConfig }) =>
                    (state ?? []).map((blocklistConfig, i) => (i === index ? newUrlBlocklistConfig : blocklistConfig)),
                removeUrlBlocklist: (state, { index }) => {
                    return (state ?? []).filter((_, i) => i !== index)
                },
            },
        ],
        editUrlBlocklistIndex: [
            null as number | null,
            {
                setEditUrlBlocklistIndex: (_, { originalIndex }) => originalIndex,
                removeUrlBlocklist: (editUrlBlocklistIndex, { index }) =>
                    editUrlBlocklistIndex && index < editUrlBlocklistIndex
                        ? editUrlBlocklistIndex - 1
                        : index === editUrlBlocklistIndex
                        ? null
                        : editUrlBlocklistIndex,
                newUrlBlocklist: () => -1,
                updateUrlBlocklist: () => null,
                addUrlBlocklist: () => null,
            },
        ],
        eventTriggerConfig: [
            null as string[] | null,
            {
                // we have seen some instances where a user manages to get a null into the array.
                // we guard against this by filtering out nulls, and empty strings
                // since we only want valid strings, empty arrays or null-ish, as the value here
                setEventTriggerConfig: (_, { eventTriggerConfig }) =>
                    eventTriggerConfig?.filter(isStringWithLength) ?? null,
                updateEventTriggerConfig: (_, { eventTriggerConfig }) =>
                    eventTriggerConfig?.filter(isStringWithLength) ?? null,
            },
        ],
    }),
    selectors({
        remoteUrlTriggerConfig: [
            (s) => [s.currentTeam],
            (currentTeam) => currentTeam?.session_recording_url_trigger_config,
        ],
        isAddUrlTriggerConfigFormVisible: [
            (s) => [s.editUrlTriggerIndex],
            (editUrlTriggerIndex) => editUrlTriggerIndex === -1,
        ],
        urlTriggerToEdit: [
            (s) => [s.urlTriggerConfig, s.editUrlTriggerIndex],
            (urlTriggerConfig, editUrlTriggerIndex) => {
                if (
                    editUrlTriggerIndex === null ||
                    editUrlTriggerIndex === -1 ||
                    !urlTriggerConfig?.[editUrlTriggerIndex]
                ) {
                    return NEW_URL_TRIGGER
                }
                return urlTriggerConfig[editUrlTriggerIndex]
            },
        ],

        remoteUrlBlocklistConfig: [
            (s) => [s.currentTeam],
            (currentTeam) => currentTeam?.session_recording_url_blocklist_config,
        ],
        isAddUrlBlocklistConfigFormVisible: [
            (s) => [s.editUrlBlocklistIndex],
            (editUrlBlocklistIndex) => editUrlBlocklistIndex === -1,
        ],
        urlBlocklistToEdit: [
            (s) => [s.urlBlocklistConfig, s.editUrlBlocklistIndex],
            (urlBlocklistConfig, editUrlBlocklistIndex) => {
                if (
                    editUrlBlocklistIndex === null ||
                    editUrlBlocklistIndex === -1 ||
                    !urlBlocklistConfig?.[editUrlBlocklistIndex]
                ) {
                    return NEW_URL_TRIGGER
                }
                return urlBlocklistConfig[editUrlBlocklistIndex]
            },
        ],
    }),
    subscriptions(({ actions }) => ({
        currentTeam: (currentTeam: TeamPublicType | TeamType | null) => {
            actions.setUrlTriggerConfig(currentTeam?.session_recording_url_trigger_config ?? [])
            actions.setUrlBlocklistConfig(currentTeam?.session_recording_url_blocklist_config ?? [])
            actions.setEventTriggerConfig(
                (currentTeam?.session_recording_event_trigger_config ?? []).filter(isStringWithLength)
            )
        },
    })),
    forms(({ values, actions }) => ({
        proposedUrlTrigger: {
            defaults: { url: '', matching: 'regex' } as SessionReplayUrlTriggerConfig,
            errors: ({ url }) => ({
                url: !url ? 'Must have a URL' : undefined,
            }),
            submit: async ({ url, matching }) => {
                if (values.editUrlTriggerIndex !== null && values.editUrlTriggerIndex >= 0) {
                    actions.updateUrlTrigger(values.editUrlTriggerIndex, { url: ensureAnchored(url), matching })
                } else {
                    actions.addUrlTrigger({ url: ensureAnchored(url), matching })
                }
            },
        },
        proposedUrlBlocklist: {
            defaults: { url: '', matching: 'regex' } as SessionReplayUrlTriggerConfig,
            errors: ({ url }) => ({
                url: !url ? 'Must have a URL' : undefined,
            }),
            submit: async ({ url, matching }) => {
                if (values.editUrlBlocklistIndex !== null && values.editUrlBlocklistIndex >= 0) {
                    actions.updateUrlBlocklist(values.editUrlBlocklistIndex, { url: ensureAnchored(url), matching })
                } else {
                    actions.addUrlBlocklist({ url: ensureAnchored(url), matching })
                }
            },
        },
    })),
    sharedListeners(({ values }) => ({
        saveUrlTriggers: async () => {
            await teamLogic.asyncActions.updateCurrentTeam({
                session_recording_url_trigger_config: values.urlTriggerConfig ?? [],
            })
        },
        saveUrlBlocklists: async () => {
            await teamLogic.asyncActions.updateCurrentTeam({
                session_recording_url_blocklist_config: values.urlBlocklistConfig ?? [],
            })
        },
    })),
    listeners(({ sharedListeners, actions, values }) => ({
        setEditUrlTriggerIndex: () => {
            actions.setProposedUrlTriggerValue('url', values.urlTriggerToEdit.url)
            actions.setProposedUrlTriggerValue('matching', values.urlTriggerToEdit.matching)
        },
        addUrlTrigger: sharedListeners.saveUrlTriggers,
        removeUrlTrigger: sharedListeners.saveUrlTriggers,
        updateUrlTrigger: sharedListeners.saveUrlTriggers,
        submitProposedUrlTriggerSuccess: () => {
            actions.setEditUrlTriggerIndex(null)
            actions.resetProposedUrlTrigger()
        },

        setEditUrlBlocklistIndex: () => {
            actions.setProposedUrlBlocklistValue('url', values.urlBlocklistToEdit.url)
            actions.setProposedUrlBlocklistValue('matching', values.urlBlocklistToEdit.matching)
        },
        addUrlBlocklist: sharedListeners.saveUrlBlocklists,
        removeUrlBlocklist: sharedListeners.saveUrlBlocklists,
        updateUrlBlocklist: sharedListeners.saveUrlBlocklists,
        submitProposedUrlBlocklistSuccess: () => {
            actions.setEditUrlBlocklistIndex(null)
            actions.resetProposedUrlBlocklist()
        },
        updateEventTriggerConfig: async ({ eventTriggerConfig }) => {
            actions.setEventTriggerConfig(eventTriggerConfig)
            // ok to stringify here... this will always be a small array
            if (
                JSON.stringify(eventTriggerConfig) !==
                JSON.stringify(values.currentTeam?.session_recording_event_trigger_config)
            ) {
                await teamLogic.asyncActions.updateCurrentTeam({
                    session_recording_event_trigger_config: eventTriggerConfig,
                })
            }
        },
    })),
])
