import { IconLock } from '@posthog/icons'
import { LemonDialog, LemonInput, LemonSelect, LemonTag, lemonToast } from '@posthog/lemon-ui'
import { useActions, useValues } from 'kea'
import { router } from 'kea-router'
import { AccessControlledLemonButton } from 'lib/components/AccessControlledLemonButton'
import { ActivityLog } from 'lib/components/ActivityLog/ActivityLog'
import { FeatureFlagHog } from 'lib/components/hedgehogs'
import { MemberSelect } from 'lib/components/MemberSelect'
import { ObjectTags } from 'lib/components/ObjectTags/ObjectTags'
import { PageHeader } from 'lib/components/PageHeader'
import { ProductIntroduction } from 'lib/components/ProductIntroduction/ProductIntroduction'
import PropertyFiltersDisplay from 'lib/components/PropertyFilters/components/PropertyFiltersDisplay'
import { LemonButton } from 'lib/lemon-ui/LemonButton'
import { More } from 'lib/lemon-ui/LemonButton/More'
import { LemonDivider } from 'lib/lemon-ui/LemonDivider'
import { LemonTable, LemonTableColumn, LemonTableColumns } from 'lib/lemon-ui/LemonTable'
import { createdAtColumn, createdByColumn } from 'lib/lemon-ui/LemonTable/columnUtils'
import { LemonTableLink } from 'lib/lemon-ui/LemonTable/LemonTableLink'
import { LemonTabs } from 'lib/lemon-ui/LemonTabs'
import { Tooltip } from 'lib/lemon-ui/Tooltip'
import { FEATURE_FLAGS } from 'lib/constants'
import { featureFlagLogic as enabledFeaturesLogic } from 'lib/logic/featureFlagLogic'
import { copyToClipboard } from 'lib/utils/copyToClipboard'
import { deleteWithUndo } from 'lib/utils/deleteWithUndo'
import { getAppContext } from 'lib/utils/getAppContext'
import stringWithWBR from 'lib/utils/stringWithWBR'
import { projectLogic } from 'scenes/projectLogic'
import { SceneExport } from 'scenes/sceneTypes'
import { urls } from 'scenes/urls'
import { userLogic } from 'scenes/userLogic'

import { groupsModel, Noun } from '~/models/groupsModel'
import { InsightVizNode, NodeKind } from '~/queries/schema/schema-general'
import { AccessControlResourceType, ProductKey } from '~/types'
import {
    AccessControlLevel,
    ActivityScope,
    AnyPropertyFilter,
    AvailableFeature,
    BaseMathType,
    FeatureFlagEvaluationRuntime,
    FeatureFlagFilters,
    FeatureFlagType,
} from '~/types'

import { featureFlagLogic } from './featureFlagLogic'
import { featureFlagsLogic, FeatureFlagsTab, FLAGS_PER_PAGE } from './featureFlagsLogic'

export const scene: SceneExport = {
    component: FeatureFlags,
    logic: featureFlagsLogic,
    settingSectionId: 'environment-feature-flags',
}

export function OverViewTab({
    flagPrefix = '',
    searchPlaceholder = 'Search for feature flags',
    nouns = ['feature flag', 'feature flags'],
}: {
    flagPrefix?: string
    searchPlaceholder?: string
    nouns?: [string, string]
}): JSX.Element {
    const { currentProjectId } = useValues(projectLogic)
    const { aggregationLabel } = useValues(groupsModel)

    const flagLogic = featureFlagsLogic({ flagPrefix })
    const { featureFlagsLoading, featureFlags, count, pagination, filters, shouldShowEmptyState } = useValues(flagLogic)
    const { updateFeatureFlag, loadFeatureFlags, setFeatureFlagsFilters } = useActions(flagLogic)
    const { hasAvailableFeature } = useValues(userLogic)

    const page = filters.page || 1
    const startCount = (page - 1) * FLAGS_PER_PAGE + 1
    const endCount = page * FLAGS_PER_PAGE < count ? page * FLAGS_PER_PAGE : count

    const tryInInsightsUrl = (featureFlag: FeatureFlagType): string => {
        const query: InsightVizNode = {
            kind: NodeKind.InsightVizNode,
            source: {
                kind: NodeKind.TrendsQuery,
                series: [
                    {
                        event: '$pageview',
                        name: '$pageview',
                        kind: NodeKind.EventsNode,
                        math: BaseMathType.UniqueUsers,
                    },
                ],
                breakdownFilter: {
                    breakdown_type: 'event',
                    breakdown: `$feature/${featureFlag.key}`,
                },
            },
        }
        return urls.insightNew({ query })
    }

    const columns: LemonTableColumns<FeatureFlagType> = [
        {
            title: 'Key',
            dataIndex: 'key',
            className: 'ph-no-capture',
            sticky: true,
            width: '40%',
            sorter: (a: FeatureFlagType, b: FeatureFlagType) => (a.key || '').localeCompare(b.key || ''),
            render: function Render(_, featureFlag: FeatureFlagType) {
                return (
                    <LemonTableLink
                        to={featureFlag.id ? urls.featureFlag(featureFlag.id) : undefined}
                        title={
                            <>
                                <span>{stringWithWBR(featureFlag.key, 17)}</span>
                                {!featureFlag.can_edit && (
                                    <Tooltip title="You don't have edit permissions for this feature flag.">
                                        <IconLock
                                            style={{
                                                marginLeft: 6,
                                                verticalAlign: '-0.125em',
                                                display: 'inline',
                                            }}
                                        />
                                    </Tooltip>
                                )}
                            </>
                        }
                        description={featureFlag.name}
                    />
                )
            },
        },
        ...(hasAvailableFeature(AvailableFeature.TAGGING)
            ? [
                  {
                      title: 'Tags',
                      dataIndex: 'tags' as keyof FeatureFlagType,
                      render: function Render(tags: FeatureFlagType['tags']) {
                          return tags ? <ObjectTags tags={tags} staticOnly /> : null
                      },
                  } as LemonTableColumn<FeatureFlagType, keyof FeatureFlagType | undefined>,
              ]
            : []),
        createdByColumn<FeatureFlagType>() as LemonTableColumn<FeatureFlagType, keyof FeatureFlagType | undefined>,
        createdAtColumn<FeatureFlagType>() as LemonTableColumn<FeatureFlagType, keyof FeatureFlagType | undefined>,
        {
            title: 'Release conditions',
            width: 100,
            render: function Render(_, featureFlag: FeatureFlagType) {
                const releaseText = groupFilters(featureFlag.filters, undefined, aggregationLabel)
                return typeof releaseText === 'string' && releaseText.startsWith('100% of') ? (
                    <LemonTag type="highlight">{releaseText}</LemonTag>
                ) : (
                    releaseText
                )
            },
        },
        {
            title: 'Status',
            dataIndex: 'active',
            sorter: (a: FeatureFlagType, b: FeatureFlagType) => Number(a.active) - Number(b.active),
            width: 100,
            render: function RenderActive(_, featureFlag: FeatureFlagType) {
                return (
                    <div className="flex justify-start gap-1">
                        {featureFlag.performed_rollback ? (
                            <LemonTag type="warning" className="uppercase">
                                Rolled Back
                            </LemonTag>
                        ) : featureFlag.active ? (
                            <LemonTag type="success" className="uppercase">
                                Enabled
                            </LemonTag>
                        ) : (
                            <LemonTag type="default" className="uppercase">
                                Disabled
                            </LemonTag>
                        )}
                        {featureFlag.status === 'STALE' && (
                            <Tooltip
                                title={
                                    <>
                                        <div className="text-sm">Flag at least 30 days old and fully rolled out</div>
                                        <div className="text-xs">
                                            Make sure to remove any references to this flag in your code before deleting
                                            it.
                                        </div>
                                    </>
                                }
                                placement="left"
                            >
                                <span>
                                    <LemonTag type="warning" className="uppercase cursor-default">
                                        Stale
                                    </LemonTag>
                                </span>
                            </Tooltip>
                        )}
                    </div>
                )
            },
        },
        ...(enabledFeaturesLogic.values.featureFlags?.[FEATURE_FLAGS.FLAG_EVALUATION_RUNTIMES]
            ? [
                  {
                      title: 'Runtime',
                      dataIndex: 'evaluation_runtime' as keyof FeatureFlagType,
                      width: 120,
                      render: function RenderFlagRuntime(_: any, featureFlag: FeatureFlagType) {
                          const runtime = featureFlag.evaluation_runtime || FeatureFlagEvaluationRuntime.ALL
                          return (
                              <LemonTag type="default" className="uppercase">
                                  {runtime === FeatureFlagEvaluationRuntime.ALL
                                      ? 'All'
                                      : runtime === FeatureFlagEvaluationRuntime.CLIENT
                                      ? 'Client'
                                      : runtime === FeatureFlagEvaluationRuntime.SERVER
                                      ? 'Server'
                                      : 'All'}
                              </LemonTag>
                          )
                      },
                  },
              ]
            : []),
        {
            width: 0,
            render: function Render(_, featureFlag: FeatureFlagType) {
                return (
                    <More
                        overlay={
                            <>
                                <LemonButton
                                    onClick={() => {
                                        void copyToClipboard(featureFlag.key, 'feature flag key')
                                    }}
                                    fullWidth
                                >
                                    Copy feature flag key
                                </LemonButton>

                                <AccessControlledLemonButton
                                    userAccessLevel={featureFlag.user_access_level}
                                    minAccessLevel={AccessControlLevel.Editor}
                                    resourceType={AccessControlResourceType.FeatureFlag}
                                    data-attr={`feature-flag-${featureFlag.key}-switch`}
                                    onClick={() => {
                                        const newValue = !featureFlag.active
                                        LemonDialog.open({
                                            title: `${newValue === true ? 'Enable' : 'Disable'} this flag?`,
                                            description: `This flag will be immediately ${
                                                newValue === true ? 'rolled out to' : 'rolled back from'
                                            } the users matching the release conditions.`,
                                            primaryButton: {
                                                children: 'Confirm',
                                                type: 'primary',
                                                onClick: () => {
                                                    featureFlag.id
                                                        ? updateFeatureFlag({
                                                              id: featureFlag.id,
                                                              payload: { active: newValue },
                                                          })
                                                        : null
                                                },
                                                size: 'small',
                                            },
                                            secondaryButton: {
                                                children: 'Cancel',
                                                type: 'tertiary',
                                                size: 'small',
                                            },
                                        })
                                    }}
                                    id={`feature-flag-${featureFlag.id}-switch`}
                                    fullWidth
                                >
                                    {featureFlag.active ? 'Disable' : 'Enable'} feature flag
                                </AccessControlledLemonButton>

                                {featureFlag.id && (
                                    <AccessControlledLemonButton
                                        userAccessLevel={featureFlag.user_access_level}
                                        minAccessLevel={AccessControlLevel.Editor}
                                        resourceType={AccessControlResourceType.FeatureFlag}
                                        fullWidth
                                        disabled={!featureFlag.can_edit}
                                        onClick={() => {
                                            if (featureFlag.id) {
                                                featureFlagLogic({ id: featureFlag.id }).mount()
                                                featureFlagLogic({ id: featureFlag.id }).actions.editFeatureFlag(true)
                                                router.actions.push(urls.featureFlag(featureFlag.id))
                                            }
                                        }}
                                    >
                                        Edit
                                    </AccessControlledLemonButton>
                                )}

                                <LemonButton
                                    to={urls.featureFlagDuplicate(featureFlag.id)}
                                    data-attr="feature-flag-duplicate"
                                    fullWidth
                                >
                                    Duplicate feature flag
                                </LemonButton>

                                <LemonButton to={tryInInsightsUrl(featureFlag)} data-attr="usage" fullWidth>
                                    Try out in Insights
                                </LemonButton>

                                <LemonDivider />

                                {featureFlag.id && (
                                    <AccessControlledLemonButton
                                        userAccessLevel={featureFlag.user_access_level}
                                        minAccessLevel={AccessControlLevel.Editor}
                                        resourceType={AccessControlResourceType.FeatureFlag}
                                        status="danger"
                                        onClick={() => {
                                            void deleteWithUndo({
                                                endpoint: `projects/${currentProjectId}/feature_flags`,
                                                object: { name: featureFlag.key, id: featureFlag.id },
                                                callback: loadFeatureFlags,
                                            }).catch((e) => {
                                                lemonToast.error(`Failed to delete feature flag: ${e.detail}`)
                                            })
                                        }}
                                        disabledReason={
                                            !featureFlag.can_edit
                                                ? "You have only 'View' access for this feature flag. To make changes, please contact the flag's creator."
                                                : (featureFlag.features?.length || 0) > 0
                                                ? 'This feature flag is in use with an early access feature. Delete the early access feature to delete this flag'
                                                : (featureFlag.experiment_set?.length || 0) > 0
                                                ? 'This feature flag is linked to an experiment. Delete the experiment to delete this flag'
                                                : null
                                        }
                                        fullWidth
                                    >
                                        Delete feature flag
                                    </AccessControlledLemonButton>
                                )}
                            </>
                        }
                    />
                )
            },
        },
    ]

    const filtersSection = (
        <div className="flex justify-between mb-4 gap-2 flex-wrap">
            <LemonInput
                className="w-60"
                type="search"
                placeholder={searchPlaceholder || ''}
                onChange={(search) => setFeatureFlagsFilters({ search, page: 1 })}
                value={filters.search || ''}
                data-attr="feature-flag-search"
            />
            <div className="flex items-center gap-2">
                <span>
                    <b>Type</b>
                </span>
                <LemonSelect
                    dropdownMatchSelectWidth={false}
                    size="small"
                    onChange={(type) => {
                        if (type) {
                            if (type === 'all') {
                                if (filters) {
                                    const { type, ...restFilters } = filters
                                    setFeatureFlagsFilters({ ...restFilters, page: 1 }, true)
                                }
                            } else {
                                setFeatureFlagsFilters({ type, page: 1 })
                            }
                        }
                    }}
                    options={[
                        { label: 'All', value: 'all' },
                        { label: 'Boolean', value: 'boolean' },
                        {
                            label: 'Multiple variants',
                            value: 'multivariant',
                            'data-attr': 'feature-flag-select-type-option-multiple-variants',
                        },
                        { label: 'Experiment', value: 'experiment' },
                        { label: 'Remote config', value: 'remote_config' },
                    ]}
                    value={filters.type ?? 'all'}
                    data-attr="feature-flag-select-type"
                />
                <span>
                    <b>Status</b>
                </span>
                <LemonSelect
                    dropdownMatchSelectWidth={false}
                    size="small"
                    onChange={(status) => {
                        const { active, ...restFilters } = filters || {}
                        if (status === 'all') {
                            setFeatureFlagsFilters({ ...restFilters, page: 1 }, true)
                        } else if (status === 'STALE') {
                            setFeatureFlagsFilters({ ...restFilters, active: 'STALE', page: 1 }, true)
                        } else {
                            setFeatureFlagsFilters({ ...restFilters, active: status, page: 1 }, true)
                        }
                    }}
                    options={[
                        { label: 'All', value: 'all', 'data-attr': 'feature-flag-select-status-all' },
                        { label: 'Enabled', value: 'true' },
                        {
                            label: 'Disabled',
                            value: 'false',
                            'data-attr': 'feature-flag-select-status-disabled',
                        },
                        {
                            label: 'Stale',
                            value: 'STALE',
                            'data-attr': 'feature-flag-select-status-stale',
                        },
                    ]}
                    value={filters.active ?? 'all'}
                    data-attr="feature-flag-select-status"
                />
                <span className="ml-1">
                    <b>Created by</b>
                </span>
                <MemberSelect
                    defaultLabel="Any user"
                    value={filters.created_by_id ?? null}
                    onChange={(user) => {
                        if (!user) {
                            if (filters) {
                                const { created_by_id, ...restFilters } = filters
                                setFeatureFlagsFilters({ ...restFilters, page: 1 }, true)
                            }
                        } else {
                            setFeatureFlagsFilters({ created_by_id: user.id, page: 1 })
                        }
                    }}
                    data-attr="feature-flag-select-created-by"
                />
                {enabledFeaturesLogic.values.featureFlags?.[FEATURE_FLAGS.FLAG_EVALUATION_RUNTIMES] && (
                    <>
                        <span className="ml-1">
                            <b>Runtime</b>
                        </span>
                        <LemonSelect
                            dropdownMatchSelectWidth={false}
                            size="small"
                            onChange={(runtime) => {
                                const { evaluation_runtime, ...restFilters } = filters || {}
                                if (runtime === 'any') {
                                    setFeatureFlagsFilters({ ...restFilters, page: 1 }, true)
                                } else {
                                    setFeatureFlagsFilters(
                                        { ...restFilters, evaluation_runtime: runtime, page: 1 },
                                        true
                                    )
                                }
                            }}
                            options={[
                                { label: 'Any', value: 'any', 'data-attr': 'feature-flag-select-runtime-any' },
                                { label: 'All', value: FeatureFlagEvaluationRuntime.ALL },
                                { label: 'Client', value: FeatureFlagEvaluationRuntime.CLIENT },
                                { label: 'Server', value: FeatureFlagEvaluationRuntime.SERVER },
                            ]}
                            value={filters.evaluation_runtime ?? 'any'}
                            data-attr="feature-flag-select-runtime"
                        />
                    </>
                )}
            </div>
        </div>
    )

    return (
        <>
            <ProductIntroduction
                productName="Feature flags"
                productKey={ProductKey.FEATURE_FLAGS}
                thingName="feature flag"
                description="Use feature flags to safely deploy and roll back new features in an easy-to-manage way. Roll variants out to certain groups, a percentage of users, or everyone all at once."
                docsURL="https://posthog.com/docs/feature-flags/manual"
                action={() => router.actions.push(urls.featureFlag('new'))}
                isEmpty={shouldShowEmptyState}
                customHog={FeatureFlagHog}
            />
            <div>{filtersSection}</div>
            <LemonDivider className="my-4" />
            <div className="mb-4">
                <span className="text-secondary ">
                    {count
                        ? `${startCount}${endCount - startCount > 1 ? '-' + endCount : ''} of ${count} flag${
                              count === 1 ? '' : 's'
                          }`
                        : null}
                </span>
            </div>

            <LemonTable
                dataSource={featureFlags.results}
                columns={columns}
                rowKey="key"
                defaultSorting={{
                    columnKey: 'created_at',
                    order: -1,
                }}
                noSortingCancellation
                loading={featureFlagsLoading}
                pagination={pagination}
                nouns={nouns}
                data-attr="feature-flag-table"
                emptyState="No results for this filter, change filter or create a new flag."
                onSort={(newSorting) =>
                    setFeatureFlagsFilters({
                        order: newSorting ? `${newSorting.order === -1 ? '-' : ''}${newSorting.columnKey}` : undefined,
                        page: 1,
                    })
                }
            />
        </>
    )
}

export function FeatureFlags(): JSX.Element {
    const { activeTab } = useValues(featureFlagsLogic)
    const { setActiveTab } = useActions(featureFlagsLogic)

    return (
        <div className="feature_flags">
            <PageHeader
                buttons={
                    <AccessControlledLemonButton
                        type="primary"
                        to={urls.featureFlag('new')}
                        data-attr="new-feature-flag"
                        resourceType={AccessControlResourceType.FeatureFlag}
                        minAccessLevel={AccessControlLevel.Editor}
                        userAccessLevel={
                            getAppContext()?.resource_access_control?.[AccessControlResourceType.FeatureFlag]
                        }
                    >
                        New feature flag
                    </AccessControlledLemonButton>
                }
            />
            <LemonTabs
                activeKey={activeTab}
                onChange={(newKey) => setActiveTab(newKey)}
                tabs={[
                    {
                        key: FeatureFlagsTab.OVERVIEW,
                        label: 'Overview',
                        content: <OverViewTab />,
                    },
                    {
                        key: FeatureFlagsTab.HISTORY,
                        label: 'History',
                        content: <ActivityLog scope={ActivityScope.FEATURE_FLAG} />,
                    },
                ]}
                data-attr="feature-flags-tab-navigation"
            />
        </div>
    )
}

export function groupFilters(
    filters: FeatureFlagFilters,
    stringOnly?: true,
    aggregationLabel?: (groupTypeIndex: number | null | undefined, deferToUserWording?: boolean) => Noun
): string
export function groupFilters(
    filters: FeatureFlagFilters,
    stringOnly?: false,
    aggregationLabel?: (groupTypeIndex: number | null | undefined, deferToUserWording?: boolean) => Noun
): JSX.Element | string
export function groupFilters(
    filters: FeatureFlagFilters,
    stringOnly?: boolean,
    aggregationLabel?: (groupTypeIndex: number | null | undefined, deferToUserWording?: boolean) => Noun
): JSX.Element | string {
    const aggregationTargetName =
        aggregationLabel && filters.aggregation_group_type_index != null
            ? aggregationLabel(filters.aggregation_group_type_index).plural
            : 'users'
    const groups = filters.groups || []

    if (groups.length === 0 || !groups.some((group) => group.rollout_percentage !== 0)) {
        // There are no rollout groups or all are at 0%
        return `No ${aggregationTargetName}`
    }
    if (
        groups.some((group) => !group.properties?.length && [null, undefined, 100].includes(group.rollout_percentage))
    ) {
        // There's some group without filters that has 100% rollout
        return `100% of all ${aggregationTargetName}`
    }

    if (groups.length === 1) {
        const { properties, rollout_percentage = null } = groups[0]
        if ((properties?.length || 0) > 0) {
            return stringOnly ? (
                `${rollout_percentage ?? 100}% of one group`
            ) : (
                <div className="flex items-center">
                    <span className="shrink-0 mr-2">{rollout_percentage ?? 100}% of</span>
                    <PropertyFiltersDisplay filters={properties as AnyPropertyFilter[]} />
                </div>
            )
        } else if (rollout_percentage !== null) {
            return `${rollout_percentage}% of all ${aggregationTargetName}`
        }
        console.error('A group with full rollout was not detected early')
        return `100% of all ${aggregationTargetName}`
    }
    return 'Multiple groups'
}
