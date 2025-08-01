import { createPostHogWidgetNode } from 'scenes/notebooks/Nodes/NodeWrapper'
import { FeatureFlagBasicType, Survey } from '~/types'
import { BindLogic, useActions, useValues } from 'kea'
import { IconSurveys } from 'lib/lemon-ui/icons'
import { LemonDivider } from '@posthog/lemon-ui'
import { urls } from 'scenes/urls'
import { LemonSkeleton } from 'lib/lemon-ui/LemonSkeleton'
import { notebookNodeLogic } from './notebookNodeLogic'
import { buildFlagContent } from './NotebookNodeFlag'
import { surveyLogic } from 'scenes/surveys/surveyLogic'
import { StatusTag } from 'scenes/surveys/Surveys'
import { SurveyResult } from 'scenes/surveys/SurveyView'
import { SurveyDisplaySummary } from 'scenes/surveys/Survey'
import { useEffect } from 'react'
import { NotFound } from 'lib/components/NotFound'
import { SurveyAppearancePreview } from 'scenes/surveys/SurveyAppearancePreview'
import { UUID_REGEX_MATCH_GROUPS } from './utils'
import { JSONContent } from 'lib/components/RichContentEditor/types'
import { NotebookNodeProps, NotebookNodeType } from '../types'

const Component = ({ attributes }: NotebookNodeProps<NotebookNodeSurveyAttributes>): JSX.Element => {
    const { id } = attributes
    const { survey, surveyLoading, targetingFlagFilters, surveyMissing } = useValues(surveyLogic({ id }))
    const { expanded, nextNode } = useValues(notebookNodeLogic)
    const { insertAfter, setActions, setTitlePlaceholder } = useActions(notebookNodeLogic)

    useEffect(() => {
        setActions([
            survey.linked_flag
                ? {
                      text: 'View linked flag',
                      onClick: () => {
                          if (nextNode?.type.name !== NotebookNodeType.FeatureFlag) {
                              insertAfter(buildFlagContent((survey.linked_flag as FeatureFlagBasicType).id))
                          }
                      },
                  }
                : undefined,
        ])
        // oxlint-disable-next-line exhaustive-deps
    }, [survey])

    useEffect(() => {
        setTitlePlaceholder(survey.name ? `Survey: ${survey.name}` : 'Survey')
        // oxlint-disable-next-line exhaustive-deps
    }, [survey.name])

    if (surveyMissing) {
        return <NotFound object="survey" />
    }

    return (
        <div>
            <BindLogic logic={surveyLogic} props={{ id }}>
                <div className="flex items-center gap-2 p-3">
                    <IconSurveys className="text-lg" />
                    {surveyLoading ? (
                        <LemonSkeleton className="h-6 flex-1" />
                    ) : (
                        <>
                            <span className="flex-1 font-semibold truncate">{survey.name}</span>
                            {/* survey has to exist in notebooks */}
                            <StatusTag survey={survey as Survey} />
                        </>
                    )}
                </div>

                {expanded ? (
                    <>
                        {survey.description && (
                            <>
                                <LemonDivider className="my-0" />
                                <span className="p-2">{survey.description}</span>
                            </>
                        )}
                        {!survey.start_date ? (
                            <>
                                <LemonDivider className="my-0" />
                                <div className="p-2">
                                    <SurveyDisplaySummary
                                        id={id}
                                        survey={survey}
                                        targetingFlagFilters={targetingFlagFilters}
                                    />

                                    <div className="w-full flex flex-col items-center">
                                        <SurveyAppearancePreview survey={survey} previewPageIndex={0} />
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* show results when the survey is running */}
                                <LemonDivider className="my-0" />
                                <div className="p-2">
                                    <SurveyResult disableEventsTable />
                                </div>
                            </>
                        )}
                    </>
                ) : null}
            </BindLogic>
        </div>
    )
}

type NotebookNodeSurveyAttributes = {
    id: string
}

export const NotebookNodeSurvey = createPostHogWidgetNode<NotebookNodeSurveyAttributes>({
    nodeType: NotebookNodeType.Survey,
    titlePlaceholder: 'Survey',
    Component,
    heightEstimate: '3rem',
    href: (attrs) => urls.survey(attrs.id),
    resizeable: false,
    attributes: {
        id: {},
    },
    pasteOptions: {
        find: urls.survey(UUID_REGEX_MATCH_GROUPS),
        getAttributes: async (match) => {
            return { id: match[1] }
        },
    },
})

export function buildSurveyContent(id: string): JSONContent {
    return {
        type: NotebookNodeType.Survey,
        attrs: { id },
    }
}
