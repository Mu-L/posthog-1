import { IconChevronDown, IconFilter, IconRevert } from '@posthog/icons'
import { LemonBadge, LemonButton, LemonButtonProps, ProfilePicture } from '@posthog/lemon-ui'
import clsx from 'clsx'
import { useActions, useMountedLogic, useValues } from 'kea'
import { DateFilter } from 'lib/components/DateFilter/DateFilter'
import { FlaggedFeature } from 'lib/components/FlaggedFeature'
import { TaxonomicFilterGroupType } from 'lib/components/TaxonomicFilter/types'
import UniversalFilters from 'lib/components/UniversalFilters/UniversalFilters'
import { universalFiltersLogic } from 'lib/components/UniversalFilters/universalFiltersLogic'
import { isUniversalGroupFilterLike } from 'lib/components/UniversalFilters/utils'
import { FEATURE_FLAGS } from 'lib/constants'
import posthog from 'posthog-js'
import { useEffect, useState } from 'react'
import { TestAccountFilter } from 'scenes/insights/filters/TestAccountFilter'
import { playlistLogic } from 'scenes/session-recordings/playlist/playlistLogic'
import { userLogic } from 'scenes/userLogic'

import { actionsModel } from '~/models/actionsModel'
import { cohortsModel } from '~/models/cohortsModel'
import { AndOrFilterSelect } from '~/queries/nodes/InsightViz/PropertyGroupFilters/AndOrFilterSelect'
import { NodeKind } from '~/queries/schema/schema-general'
import { RecordingUniversalFilters, UniversalFiltersGroup } from '~/types'

import { DurationFilter } from './DurationFilter'

export const RecordingsUniversalFilters = ({
    filters,
    setFilters,
    resetFilters,
    totalFiltersCount,
    className,
    allowReplayHogQLFilters = false,
    allowReplayFlagsFilters = false,
}: {
    filters: RecordingUniversalFilters
    setFilters: (filters: Partial<RecordingUniversalFilters>) => void
    resetFilters?: () => void
    totalFiltersCount?: number
    className?: string
    allowReplayFlagsFilters?: boolean
    allowReplayHogQLFilters?: boolean
}): JSX.Element => {
    useMountedLogic(cohortsModel)
    useMountedLogic(actionsModel)

    const durationFilter = filters.duration[0]

    const [isFiltersExpanded, setIsFiltersExpanded] = useState(false)

    const { isExpanded } = useValues(playlistLogic)
    const { setIsExpanded } = useActions(playlistLogic)

    const taxonomicGroupTypes = [
        TaxonomicFilterGroupType.Replay,
        TaxonomicFilterGroupType.Events,
        TaxonomicFilterGroupType.EventProperties,
        TaxonomicFilterGroupType.Actions,
        TaxonomicFilterGroupType.Cohorts,
        TaxonomicFilterGroupType.PersonProperties,
        TaxonomicFilterGroupType.SessionProperties,
    ]

    if (allowReplayHogQLFilters) {
        taxonomicGroupTypes.push(TaxonomicFilterGroupType.HogQLExpression)
    }

    if (allowReplayFlagsFilters) {
        taxonomicGroupTypes.push(TaxonomicFilterGroupType.EventFeatureFlags)
    }

    function IconMaxFromHedgehogConfig(): JSX.Element {
        const { user } = useValues(userLogic)
        return (
            <ProfilePicture
                user={{ hedgehog_config: { ...user?.hedgehog_config, use_as_profile: true } }}
                size="md"
                className="border bg-bg-light -scale-x-100" // Flip the hedegehog to face the scene
            />
        )
    }

    return (
        <>
            <div className="flex justify-center relative gap-2">
                <LemonButton
                    className="flex-1"
                    type="secondary"
                    icon={<IconFilter />}
                    sideIcon={<IconChevronDown className={isFiltersExpanded ? 'rotate-180' : ''} />}
                    onClick={() => {
                        setIsFiltersExpanded(!isFiltersExpanded)
                    }}
                >
                    Filters{' '}
                    {totalFiltersCount && totalFiltersCount > 0 ? (
                        <LemonBadge.Number count={totalFiltersCount} />
                    ) : null}
                </LemonButton>
                <FlaggedFeature flag={FEATURE_FLAGS.RECORDINGS_AI_FILTER}>
                    <LemonButton
                        type="secondary"
                        icon={<IconMaxFromHedgehogConfig />}
                        onClick={() => {
                            setIsExpanded(!isExpanded)
                            posthog.capture('ai_filter_open')
                            // If the AI filter is not expanded, we need to expand the filters
                            if (!isExpanded) {
                                setIsFiltersExpanded(true)
                            }
                        }}
                    >
                        Help
                    </LemonButton>
                </FlaggedFeature>
            </div>
            <div
                className={clsx(
                    'flex justify-center relative border-r border-l rounded-b overflow-hidden transition-all duration-200',
                    isFiltersExpanded ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'
                )}
            >
                <div className={clsx('divide-y bg-surface-primary rounded-b w-full', className)}>
                    <div className="flex items-center my-2">
                        <AndOrFilterSelect
                            value={filters.filter_group.type}
                            onChange={(type) => {
                                let values = filters.filter_group.values

                                // set the type on the nested child when only using a single filter group
                                const hasSingleGroup = values.length === 1
                                if (hasSingleGroup) {
                                    const group = values[0] as UniversalFiltersGroup
                                    values = [{ ...group, type }]
                                }

                                setFilters({
                                    filter_group: {
                                        type: type,
                                        values: values,
                                    },
                                })
                            }}
                            topLevelFilter={true}
                            suffix={['filter', 'filters']}
                            size="xsmall"
                        />
                    </div>
                    <div className="flex justify-between px-2 py-2 flex-wrap gap-1">
                        <div className="flex flex-wrap gap-2 items-center">
                            <DateFilter
                                dateFrom={filters.date_from ?? '-3d'}
                                dateTo={filters.date_to}
                                onChange={(changedDateFrom, changedDateTo) => {
                                    setFilters({
                                        date_from: changedDateFrom,
                                        date_to: changedDateTo,
                                    })
                                }}
                                dateOptions={[
                                    { key: 'Custom', values: [] },
                                    { key: 'Last 24 hours', values: ['-24h'] },
                                    { key: 'Last 3 days', values: ['-3d'] },
                                    { key: 'Last 7 days', values: ['-7d'] },
                                    { key: 'Last 30 days', values: ['-30d'] },
                                    { key: 'All time', values: ['-90d'] },
                                ]}
                                dropdownPlacement="bottom-start"
                                size="xsmall"
                            />
                            <DurationFilter
                                onChange={(newRecordingDurationFilter, newDurationType) => {
                                    setFilters({
                                        duration: [{ ...newRecordingDurationFilter, key: newDurationType }],
                                    })
                                }}
                                recordingDurationFilter={durationFilter}
                                durationTypeFilter={durationFilter.key}
                                pageKey="session-recordings"
                                size="xsmall"
                            />
                        </div>
                        <div>
                            <TestAccountFilter
                                size="xsmall"
                                filters={filters}
                                onChange={(testFilters) =>
                                    setFilters({ filter_test_accounts: testFilters.filter_test_accounts })
                                }
                            />
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 p-2">
                        <UniversalFilters
                            rootKey="session-recordings"
                            group={filters.filter_group}
                            taxonomicGroupTypes={taxonomicGroupTypes}
                            onChange={(filterGroup) => setFilters({ filter_group: filterGroup })}
                        >
                            <RecordingsUniversalFilterGroup size="xsmall" />
                        </UniversalFilters>
                        {resetFilters && (totalFiltersCount ?? 0) > 0 && (
                            <LemonButton type="tertiary" size="xsmall" onClick={resetFilters} icon={<IconRevert />}>
                                Reset
                            </LemonButton>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}

const RecordingsUniversalFilterGroup = ({ size = 'small' }: { size?: LemonButtonProps['size'] }): JSX.Element => {
    const { filterGroup } = useValues(universalFiltersLogic)
    const { replaceGroupValue, removeGroupValue } = useActions(universalFiltersLogic)
    const [allowInitiallyOpen, setAllowInitiallyOpen] = useState(false)

    useEffect(() => {
        setAllowInitiallyOpen(true)
    }, [])

    return (
        <>
            {filterGroup.values.map((filterOrGroup, index) => {
                return isUniversalGroupFilterLike(filterOrGroup) ? (
                    <UniversalFilters.Group key={index} index={index} group={filterOrGroup}>
                        <RecordingsUniversalFilterGroup size={size} />
                        <UniversalFilters.AddFilterButton size={size} type="secondary" />
                    </UniversalFilters.Group>
                ) : (
                    <UniversalFilters.Value
                        key={index}
                        index={index}
                        filter={filterOrGroup}
                        onRemove={() => removeGroupValue(index)}
                        onChange={(value) => replaceGroupValue(index, value)}
                        initiallyOpen={allowInitiallyOpen}
                        metadataSource={{ kind: NodeKind.RecordingsQuery }}
                    />
                )
            })}
        </>
    )
}
