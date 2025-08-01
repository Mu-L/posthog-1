import { IconEllipsis, IconGear, IconOpenSidebar } from '@posthog/icons'
import { LemonBadge, LemonButton, LemonMenu } from '@posthog/lemon-ui'
import { useActions, useValues } from 'kea'
import { router } from 'kea-router'
import {
    authorizedUrlListLogic,
    AuthorizedUrlListType,
    defaultAuthorizedUrlProperties,
} from 'lib/components/AuthorizedUrlList/authorizedUrlListLogic'
import { FilmCameraHog, WarningHog } from 'lib/components/hedgehogs'
import { PageHeader } from 'lib/components/PageHeader'
import { ProductIntroduction } from 'lib/components/ProductIntroduction/ProductIntroduction'
import { VersionCheckerBanner } from 'lib/components/VersionChecker/VersionCheckerBanner'
import { FEATURE_FLAGS } from 'lib/constants'
import { useAsyncHandler } from 'lib/hooks/useAsyncHandler'
import { LemonBanner } from 'lib/lemon-ui/LemonBanner'
import { LemonTab, LemonTabs } from 'lib/lemon-ui/LemonTabs'
import { Spinner } from 'lib/lemon-ui/Spinner/Spinner'
import { featureFlagLogic } from 'lib/logic/featureFlagLogic'
import { NotebookSelectButton } from 'scenes/notebooks/NotebookSelectButton/NotebookSelectButton'
import { SceneExport } from 'scenes/sceneTypes'
import { sessionRecordingsPlaylistLogic } from 'scenes/session-recordings/playlist/sessionRecordingsPlaylistLogic'
import { teamLogic } from 'scenes/teamLogic'
import { urls } from 'scenes/urls'

import { ProductKey, ReplayTab, ReplayTabs } from '~/types'

import { createPlaylist } from './playlist/playlistUtils'
import { SessionRecordingsPlaylist } from './playlist/SessionRecordingsPlaylist'
import { SavedSessionRecordingPlaylists } from './saved-playlists/SavedSessionRecordingPlaylists'
import { sessionRecordingEventUsageLogic } from './sessionRecordingEventUsageLogic'
import { sessionReplaySceneLogic } from './sessionReplaySceneLogic'
import SessionRecordingTemplates from './templates/SessionRecordingTemplates'
import { NotebookNodeType } from 'scenes/notebooks/types'

function Header(): JSX.Element {
    const { tab } = useValues(sessionReplaySceneLogic)
    const { currentTeam } = useValues(teamLogic)
    const recordingsDisabled = currentTeam && !currentTeam?.session_recording_opt_in
    const { reportRecordingPlaylistCreated } = useActions(sessionRecordingEventUsageLogic)

    // NB this relies on `updateSearchParams` being the only prop needed to pick the correct "Recent" tab list logic
    const { filters } = useValues(sessionRecordingsPlaylistLogic({ updateSearchParams: true }))

    const newPlaylistHandler = useAsyncHandler(async () => {
        await createPlaylist({ _create_in_folder: 'Unfiled/Replay playlists', type: 'collection' }, true)
        reportRecordingPlaylistCreated('new')
    })

    return (
        <PageHeader
            buttons={
                <>
                    {tab === ReplayTabs.Home && !recordingsDisabled && (
                        <>
                            <LemonMenu
                                items={[
                                    {
                                        label: 'Playback from PostHog JSON file',
                                        to: urls.replayFilePlayback(),
                                    },
                                ]}
                            >
                                <LemonButton icon={<IconEllipsis />} />
                            </LemonMenu>
                            <NotebookSelectButton
                                resource={{
                                    type: NotebookNodeType.RecordingPlaylist,
                                    attrs: { filters: filters },
                                }}
                                type="secondary"
                            />
                        </>
                    )}

                    {tab === ReplayTabs.Playlists && (
                        <LemonButton
                            type="primary"
                            onClick={(e) => newPlaylistHandler.onEvent?.(e)}
                            data-attr="save-recordings-playlist-button"
                            loading={newPlaylistHandler.loading}
                        >
                            New collection
                        </LemonButton>
                    )}
                </>
            }
        />
    )
}

function Warnings(): JSX.Element {
    const { currentTeam } = useValues(teamLogic)
    const recordingsDisabled = currentTeam && !currentTeam?.session_recording_opt_in

    const theAuthorizedUrlsLogic = authorizedUrlListLogic({
        ...defaultAuthorizedUrlProperties,
        type: AuthorizedUrlListType.RECORDING_DOMAINS,
    })
    const { suggestions, authorizedUrls } = useValues(theAuthorizedUrlsLogic)
    const { featureFlags } = useValues(featureFlagLogic)

    const mightBeRefusingRecordings = suggestions.length > 0 && authorizedUrls.length > 0
    const settingLevel = featureFlags[FEATURE_FLAGS.ENVIRONMENTS] ? 'environment' : 'project'

    return (
        <>
            <VersionCheckerBanner />

            {recordingsDisabled ? (
                <LemonBanner type="info" hideIcon={true}>
                    <div className="flex gap-8 p-8 md:flex-row justify-center flex-wrap">
                        <div className="flex justify-center items-center w-full md:w-50">
                            <WarningHog className="w-full h-auto md:h-[200px] md:w-[200px] max-w-50" />
                        </div>
                        <div className="flex flex-col gap-2 flex-shrink max-w-180">
                            <h2 className="text-lg font-semibold">
                                Session recordings are not yet enabled for this {settingLevel}
                            </h2>
                            <p className="font-normal">Enabling session recordings will help you:</p>
                            <ul className="list-disc list-inside font-normal">
                                <li>
                                    <strong>Understand user behavior:</strong> Get a clear view of how people navigate
                                    and interact with your product.
                                </li>
                                <li>
                                    <strong>Identify UI/UX issues:</strong> Spot friction points and refine your design
                                    to increase usability.
                                </li>
                                <li>
                                    <strong>Improve customer support:</strong> Quickly diagnose problems and provide
                                    more accurate solutions.
                                </li>
                                <li>
                                    <strong>Refine product decisions:</strong> Use real insights to prioritize features
                                    and improvements.
                                </li>
                            </ul>
                            <p className="font-normal">
                                Enable session recordings to unlock these benefits and create better experiences for
                                your users.
                            </p>
                            <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
                                <LemonButton
                                    className="hidden @md:flex"
                                    type="primary"
                                    icon={<IconGear />}
                                    to={urls.replaySettings()}
                                >
                                    Configure
                                </LemonButton>
                                <LemonButton
                                    type="tertiary"
                                    sideIcon={<IconOpenSidebar className="w-4 h-4" />}
                                    to="https://posthog.com/docs/session-replay?utm_medium=in-product&utm_campaign=empty-state-docs-link"
                                    data-attr="product-introduction-docs-link"
                                    targetBlank
                                >
                                    Learn more
                                </LemonButton>
                            </div>
                        </div>
                    </div>
                </LemonBanner>
            ) : (
                <ProductIntroduction
                    productName="session replay"
                    productKey={ProductKey.SESSION_REPLAY}
                    thingName="playlist"
                    description="Use session replay playlists to easily group and analyze user sessions. Curate playlists based on events or user segments, spot patterns, diagnose issues, and share insights with your team."
                    docsURL="https://posthog.com/docs/session-replay/manual"
                    customHog={FilmCameraHog}
                />
            )}

            {!recordingsDisabled && mightBeRefusingRecordings ? (
                <LemonBanner
                    type="warning"
                    action={{
                        type: 'secondary',
                        icon: <IconGear />,
                        to: urls.replaySettings('replay-authorized-domains'),
                        children: 'Configure',
                    }}
                    dismissKey={`session-recordings-authorized-domains-warning/${suggestions.join(',')}`}
                >
                    You have unauthorized domains trying to send recordings. To accept recordings from these domains,
                    please check your config.
                </LemonBanner>
            ) : null}
        </>
    )
}

function MainPanel(): JSX.Element {
    const { tab } = useValues(sessionReplaySceneLogic)

    return (
        <div className="deprecated-space-y-4 mt-2">
            <Warnings />

            {!tab ? (
                <Spinner />
            ) : tab === ReplayTabs.Home ? (
                <div className="SessionRecordingPlaylistHeightWrapper">
                    <SessionRecordingsPlaylist updateSearchParams />
                </div>
            ) : tab === ReplayTabs.Playlists ? (
                <SavedSessionRecordingPlaylists tab={ReplayTabs.Playlists} />
            ) : tab === ReplayTabs.Templates ? (
                <SessionRecordingTemplates />
            ) : null}
        </div>
    )
}

const ReplayPageTabs: ReplayTab[] = [
    {
        label: 'Recordings',
        tooltipDocLink: 'https://posthog.com/docs/session-replay/tutorials',
        key: ReplayTabs.Home,
        'data-attr': 'session-recordings-home-tab',
    },
    {
        label: 'Collections',
        tooltipDocLink: 'https://posthog.com/docs/session-replay/how-to-watch-recordings',
        key: ReplayTabs.Playlists,
        tooltip: 'View & create collections',
        'data-attr': 'session-recordings-collections-tab',
    },
    {
        label: 'Figure out what to watch',
        key: ReplayTabs.Templates,
        'data-attr': 'session-recordings-templates-tab',
    },
    {
        label: 'Settings',
        key: ReplayTabs.Settings,
        'data-attr': 'session-recordings-settings-tab',
    },
]

function PageTabs(): JSX.Element {
    const { tab, shouldShowNewBadge } = useValues(sessionReplaySceneLogic)

    return (
        <LemonTabs
            activeKey={tab}
            className="flex"
            onChange={(t) => router.actions.push(urls.replay(t as ReplayTabs))}
            tabs={ReplayPageTabs.map((replayTab): LemonTab<string> => {
                return {
                    label: (
                        <>
                            {replayTab.label}
                            {replayTab.label === ReplayTabs.Templates && shouldShowNewBadge && (
                                <LemonBadge className="ml-1" size="small" />
                            )}
                        </>
                    ),
                    key: replayTab.key,
                    tooltip: replayTab.tooltip,
                    tooltipDocLink: replayTab.tooltipDocLink,
                    'data-attr': replayTab['data-attr'],
                }
            })}
        />
    )
}
export function SessionsRecordings(): JSX.Element {
    return (
        <>
            <Header />
            <PageTabs />
            <MainPanel />
        </>
    )
}

export const scene: SceneExport = {
    component: SessionsRecordings,
    logic: sessionReplaySceneLogic,
    settingSectionId: 'environment-replay',
}
