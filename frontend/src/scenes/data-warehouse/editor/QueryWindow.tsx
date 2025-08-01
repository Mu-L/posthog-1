import { Monaco } from '@monaco-editor/react'
import { IconBook, IconDownload, IconInfo, IconPlayFilled, IconSidebarClose } from '@posthog/icons'
import { LemonDivider, Spinner } from '@posthog/lemon-ui'
import { useActions, useValues } from 'kea'
import { router } from 'kea-router'
import { IconCancel } from 'lib/lemon-ui/icons'
import { LemonButton } from 'lib/lemon-ui/LemonButton'
import { Link } from 'lib/lemon-ui/Link'
import type { editor as importedEditor } from 'monaco-editor'
import { useMemo } from 'react'
import { urls } from 'scenes/urls'

import { panelLayoutLogic } from '~/layout/panel-layout/panelLayoutLogic'
import { dataNodeLogic } from '~/queries/nodes/DataNode/dataNodeLogic'

import { FixErrorButton } from './components/FixErrorButton'
import { editorSizingLogic } from './editorSizingLogic'
import { multitabEditorLogic } from './multitabEditorLogic'
import { OutputPane } from './OutputPane'
import { QueryHistoryModal } from './QueryHistoryModal'
import { QueryPane } from './QueryPane'
import { QueryTabs } from './QueryTabs'
import { draftsLogic } from './draftsLogic'
import { NodeKind } from '~/queries/schema/schema-general'
import { dataWarehouseViewsLogic } from '../saved_queries/dataWarehouseViewsLogic'
import { featureFlagLogic } from 'lib/logic/featureFlagLogic'
import { FEATURE_FLAGS } from 'lib/constants'

interface QueryWindowProps {
    onSetMonacoAndEditor: (monaco: Monaco, editor: importedEditor.IStandaloneCodeEditor) => void
}

export function QueryWindow({ onSetMonacoAndEditor }: QueryWindowProps): JSX.Element {
    const codeEditorKey = `hogQLQueryEditor/${router.values.location.pathname}`

    const {
        allTabs,
        activeModelUri,
        queryInput,
        editingView,
        editingInsight,
        sourceQuery,
        originalQueryInput,
        suggestedQueryInput,
        isDraft,
        currentDraft,
        changesToSave,
        inProgressViewEdits,
        activeTab,
    } = useValues(multitabEditorLogic)

    const { activePanelIdentifier } = useValues(panelLayoutLogic)
    const { setActivePanelIdentifier } = useActions(panelLayoutLogic)

    const {
        renameTab,
        selectTab,
        deleteTab,
        createTab,
        setQueryInput,
        runQuery,
        setError,
        setMetadata,
        setMetadataLoading,
        saveAsView,
        saveDraft,
        updateView,
    } = useActions(multitabEditorLogic)
    const { openHistoryModal } = useActions(multitabEditorLogic)

    const { saveOrUpdateDraft } = useActions(draftsLogic)
    const { response } = useValues(dataNodeLogic)
    const { updatingDataWarehouseSavedQuery } = useValues(dataWarehouseViewsLogic)
    const { sidebarWidth } = useValues(editorSizingLogic)
    const { resetDefaultSidebarWidth } = useActions(editorSizingLogic)
    const { featureFlags } = useValues(featureFlagLogic)

    const [editingViewDisabledReason, EditingViewButtonIcon] = useMemo(() => {
        if (updatingDataWarehouseSavedQuery) {
            return ['Saving...', Spinner]
        }

        if (!response) {
            return ['Run query to update', IconDownload]
        }

        if (!changesToSave) {
            return ['No changes to save', IconDownload]
        }

        return [undefined, IconDownload]
    }, [updatingDataWarehouseSavedQuery, changesToSave, response])

    const isMaterializedView = !!editingView?.last_run_at || !!editingView?.sync_frequency

    const renderSidebarButton = (): JSX.Element => {
        if (activePanelIdentifier !== 'Database') {
            return (
                <LemonButton
                    onClick={() => setActivePanelIdentifier('Database')}
                    className="rounded-none"
                    icon={<IconSidebarClose />}
                    type="tertiary"
                    size="small"
                />
            )
        }

        if (sidebarWidth === 0) {
            return (
                <LemonButton
                    onClick={() => resetDefaultSidebarWidth()}
                    className="rounded-none"
                    icon={<IconSidebarClose />}
                    type="tertiary"
                    size="small"
                />
            )
        }

        return <></>
    }

    return (
        <div className="flex flex-1 flex-col h-full overflow-hidden">
            <div className="flex flex-row overflow-x-auto">
                {renderSidebarButton()}
                <QueryTabs
                    models={allTabs}
                    onClick={selectTab}
                    onClear={deleteTab}
                    onAdd={createTab}
                    onRename={renameTab}
                    activeModelUri={activeModelUri}
                />
            </div>
            {(editingView || editingInsight) && (
                <div className="h-5 bg-warning-highlight">
                    <span className="pl-2 text-xs">
                        {editingView && (
                            <>
                                Editing {isDraft ? 'draft of ' : ''} {isMaterializedView ? 'materialized view' : 'view'}{' '}
                                "{editingView.name}"
                            </>
                        )}
                        {editingInsight && (
                            <>
                                Editing insight "
                                <Link to={urls.insightView(editingInsight.short_id)}>{editingInsight.name}</Link>"
                            </>
                        )}
                    </span>
                </div>
            )}
            <div className="flex flex-row justify-start align-center w-full pl-2 pr-2 bg-white dark:bg-black border-b">
                <RunButton />
                <LemonDivider vertical />
                {isDraft && featureFlags[FEATURE_FLAGS.EDITOR_DRAFTS] && (
                    <>
                        <LemonButton
                            type="tertiary"
                            size="xsmall"
                            id="sql-editor-query-window-save-as-draft"
                            onClick={() => {
                                if (editingView) {
                                    saveOrUpdateDraft(
                                        {
                                            kind: NodeKind.HogQLQuery,
                                            query: queryInput,
                                        },
                                        editingView.id,
                                        currentDraft?.id || undefined,
                                        activeTab
                                    )
                                } else {
                                    saveOrUpdateDraft(
                                        {
                                            kind: NodeKind.HogQLQuery,
                                            query: queryInput,
                                        },
                                        undefined,
                                        currentDraft?.id || undefined,
                                        activeTab
                                    )
                                }
                            }}
                        >
                            Save
                        </LemonButton>
                        <LemonButton
                            type="tertiary"
                            size="xsmall"
                            id="sql-editor-query-window-publish-draft"
                            disabledReason={editingViewDisabledReason}
                            onClick={() => {
                                if (editingView && currentDraft?.id && activeTab) {
                                    updateView(
                                        {
                                            id: editingView.id,
                                            query: {
                                                ...sourceQuery.source,
                                                query: queryInput,
                                            },
                                            name: editingView.name,
                                            types: response && 'types' in response ? response?.types ?? [] : [],
                                            shouldRematerialize: isMaterializedView,
                                            edited_history_id: activeTab.view?.latest_history_id,
                                        },
                                        currentDraft.id
                                    )
                                } else {
                                    saveAsView(false, currentDraft?.id)
                                }
                            }}
                            tooltip={
                                editingView
                                    ? 'Publishing will update the view with these changes.'
                                    : 'The view this draft is based on has been deleted. Publishing will create a new view.'
                            }
                        >
                            {!editingView && <IconInfo className="mr-1" color="var(--warning)" />}
                            Publish
                        </LemonButton>
                    </>
                )}
                {editingView && !isDraft && activeModelUri && (
                    <>
                        {featureFlags[FEATURE_FLAGS.EDITOR_DRAFTS] && (
                            <LemonButton
                                type="tertiary"
                                size="xsmall"
                                id="sql-editor-query-window-save-draft"
                                onClick={() => {
                                    saveDraft(activeModelUri, queryInput, editingView.id)
                                }}
                            >
                                Save draft
                            </LemonButton>
                        )}
                        <LemonButton
                            onClick={() =>
                                updateView({
                                    id: editingView.id,
                                    query: {
                                        ...sourceQuery.source,
                                        query: queryInput,
                                    },
                                    types: response && 'types' in response ? response?.types ?? [] : [],
                                    shouldRematerialize: isMaterializedView,
                                    edited_history_id: inProgressViewEdits[editingView.id],
                                })
                            }
                            disabledReason={editingViewDisabledReason}
                            icon={<EditingViewButtonIcon />}
                            type="tertiary"
                            size="xsmall"
                            id={`sql-editor-query-window-update-${isMaterializedView ? 'materialize' : 'view'}`}
                        >
                            {isMaterializedView ? 'Update and re-materialize view' : 'Update view'}
                        </LemonButton>
                    </>
                )}
                {editingView && (
                    <>
                        <LemonButton
                            onClick={() => openHistoryModal()}
                            icon={<IconBook />}
                            type="tertiary"
                            size="xsmall"
                            id="sql-editor-query-window-history"
                        >
                            History
                        </LemonButton>
                    </>
                )}
                {!editingInsight && !editingView && (
                    <>
                        <LemonButton
                            onClick={() => saveAsView()}
                            icon={<IconDownload />}
                            type="tertiary"
                            size="xsmall"
                            data-attr="sql-editor-save-view-button"
                            id="sql-editor-query-window-save-as-view"
                        >
                            Save as view
                        </LemonButton>
                    </>
                )}
                <FixErrorButton type="tertiary" size="xsmall" source="action-bar" />
            </div>
            <QueryPane
                originalValue={originalQueryInput}
                queryInput={suggestedQueryInput}
                sourceQuery={sourceQuery.source}
                promptError={null}
                onRun={runQuery}
                codeEditorProps={{
                    queryKey: codeEditorKey,
                    onChange: (v) => {
                        setQueryInput(v ?? '')
                    },
                    onMount: (editor, monaco) => {
                        onSetMonacoAndEditor(monaco, editor)
                    },
                    onPressCmdEnter: (value, selectionType) => {
                        if (value && selectionType === 'selection') {
                            runQuery(value)
                        } else {
                            runQuery()
                        }
                    },
                    onError: (error) => {
                        setError(error)
                    },
                    onMetadata: (metadata) => {
                        setMetadata(metadata)
                    },
                    onMetadataLoading: (loading) => {
                        setMetadataLoading(loading)
                    },
                }}
            />
            <InternalQueryWindow />
            <QueryHistoryModal />
        </div>
    )
}

function RunButton(): JSX.Element {
    const { runQuery } = useActions(multitabEditorLogic)
    const { cancelQuery } = useActions(dataNodeLogic)
    const { responseLoading } = useValues(dataNodeLogic)
    const { metadata, queryInput, isSourceQueryLastRun } = useValues(multitabEditorLogic)

    const isUsingIndices = metadata?.isUsingIndices === 'yes'

    const [iconColor, tooltipContent] = useMemo(() => {
        if (isSourceQueryLastRun) {
            return ['var(--primary)', 'No changes to run']
        }

        if (!metadata || isUsingIndices || queryInput.trim().length === 0) {
            return ['var(--success)', 'New changes to run']
        }

        const tooltipContent = !isUsingIndices
            ? 'This query is not using indices optimally, which may result in slower performance.'
            : undefined

        return ['var(--warning)', tooltipContent]
    }, [metadata, isUsingIndices, queryInput, isSourceQueryLastRun])

    return (
        <LemonButton
            data-attr="sql-editor-run-button"
            onClick={() => {
                if (responseLoading) {
                    cancelQuery()
                } else {
                    runQuery()
                }
            }}
            icon={responseLoading ? <IconCancel /> : <IconPlayFilled color={iconColor} />}
            type="tertiary"
            size="xsmall"
            tooltip={tooltipContent}
        >
            {responseLoading ? 'Cancel' : 'Run'}
        </LemonButton>
    )
}

function InternalQueryWindow(): JSX.Element | null {
    const { cacheLoading } = useValues(multitabEditorLogic)

    // NOTE: hacky way to avoid flicker loading
    if (cacheLoading) {
        return null
    }

    return <OutputPane />
}
