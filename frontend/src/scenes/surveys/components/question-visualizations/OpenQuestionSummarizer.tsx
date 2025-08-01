import { IconSparkles, IconThumbsDown, IconThumbsDownFilled, IconThumbsUp, IconThumbsUpFilled } from '@posthog/icons'
import { LemonButton } from '@posthog/lemon-ui'
import { useActions, useValues } from 'kea'

import { LemonDivider } from 'lib/lemon-ui/LemonDivider'
import { LemonMarkdown } from 'lib/lemon-ui/LemonMarkdown'
import posthog from 'posthog-js'
import { useState } from 'react'
import { maxGlobalLogic } from 'scenes/max/maxGlobalLogic'
import { AIConsentPopoverWrapper } from 'scenes/settings/organization/AIConsentPopoverWrapper'
import { surveyLogic } from 'scenes/surveys/surveyLogic'

export function ResponseSummariesButton({
    questionIndex,
    questionId,
}: {
    questionIndex: number | undefined
    questionId: string | undefined
}): JSX.Element {
    const { summarize } = useActions(surveyLogic)
    const { responseSummary, responseSummaryLoading } = useValues(surveyLogic)
    const { dataProcessingAccepted, dataProcessingApprovalDisabledReason } = useValues(maxGlobalLogic)
    const [showConsentPopover, setShowConsentPopover] = useState(false)

    const summarizeQuestion = (): void => {
        summarize({ questionIndex, questionId })
    }

    const handleSummarizeClick = (): void => {
        if (!dataProcessingAccepted) {
            setShowConsentPopover(true)
        } else {
            summarizeQuestion()
        }
    }

    const handleDismissPopover = (): void => {
        setShowConsentPopover(false)
    }

    return (
        <>
            {dataProcessingAccepted || !showConsentPopover ? (
                <LemonButton
                    type="secondary"
                    data-attr="summarize-survey"
                    onClick={handleSummarizeClick}
                    disabledReason={
                        responseSummaryLoading ? 'Let me think...' : responseSummary ? 'Already summarized' : undefined
                    }
                    icon={<IconSparkles />}
                    loading={responseSummaryLoading}
                >
                    {responseSummaryLoading ? 'Let me think...' : 'Summarize responses'}
                </LemonButton>
            ) : (
                <AIConsentPopoverWrapper showArrow onDismiss={handleDismissPopover}>
                    <LemonButton
                        type="secondary"
                        data-attr="summarize-survey"
                        onClick={handleSummarizeClick}
                        disabledReason={dataProcessingApprovalDisabledReason || 'Data processing not accepted'}
                        icon={<IconSparkles />}
                        loading={responseSummaryLoading}
                    >
                        {responseSummaryLoading ? 'Let me think...' : 'Summarize responses'}
                    </LemonButton>
                </AIConsentPopoverWrapper>
            )}
        </>
    )
}

export function ResponseSummariesDisplay(): JSX.Element {
    const { survey, responseSummary } = useValues(surveyLogic)

    return (
        <>
            {responseSummary ? (
                <>
                    <h1>Responses summary</h1>
                    <LemonMarkdown>{responseSummary.content}</LemonMarkdown>
                    <LemonDivider dashed={true} />
                    <ResponseSummaryFeedback surveyId={survey.id} />
                </>
            ) : null}
        </>
    )
}

export function ResponseSummaryFeedback({ surveyId }: { surveyId: string }): JSX.Element {
    const [rating, setRating] = useState<'good' | 'bad' | null>(null)

    function submitRating(newRating: 'good' | 'bad'): void {
        if (rating) {
            return // Already rated
        }
        setRating(newRating)
        posthog.capture('ai_survey_summary_rated', {
            survey_id: surveyId,
            answer_rating: newRating,
        })
    }

    return (
        <div className="flex items-center justify-end">
            {rating === null ? <>Summaries are generated by AI. What did you think?</> : null}
            {rating !== 'bad' && (
                <LemonButton
                    icon={rating === 'good' ? <IconThumbsUpFilled /> : <IconThumbsUp />}
                    type="tertiary"
                    size="small"
                    tooltip="Good summary"
                    onClick={() => submitRating('good')}
                />
            )}
            {rating !== 'good' && (
                <LemonButton
                    icon={rating === 'bad' ? <IconThumbsDownFilled /> : <IconThumbsDown />}
                    type="tertiary"
                    size="small"
                    tooltip="Bad summary"
                    onClick={() => submitRating('bad')}
                />
            )}
        </div>
    )
}
