import './Link.scss'

import { IconExternal, IconOpenSidebar } from '@posthog/icons'
import { router } from 'kea-router'
import { ButtonPrimitiveProps, buttonPrimitiveVariants } from 'lib/ui/Button/ButtonPrimitives'
import { isExternalLink } from 'lib/utils'
import { cn } from 'lib/utils/css-classes'
import { getCurrentTeamId } from 'lib/utils/getAppContext'
import { addProjectIdIfMissing } from 'lib/utils/router-utils'
import React, { useContext } from 'react'
import { useNotebookDrag } from 'scenes/notebooks/AddToNotebook/DraggableToNotebook'

import { sidePanelStateLogic, WithinSidePanelContext } from '~/layout/navigation-3000/sidepanel/sidePanelStateLogic'
import { SidePanelTab } from '~/types'

import { Tooltip, TooltipProps } from '../Tooltip'

type RoutePart = string | Record<string, any>

export type LinkProps = Pick<React.HTMLProps<HTMLAnchorElement>, 'target' | 'className' | 'children' | 'title'> & {
    /** The location to go to. This can be a kea-location or a "href"-like string */
    to?: string | [string, RoutePart?, RoutePart?]
    /** If true, in-app navigation will not be used and the link will navigate with a page load */
    disableClientSideRouting?: boolean
    /** If true, docs links will not be opened in the docs panel */
    disableDocsPanel?: boolean
    preventClick?: boolean
    onClick?: (event: React.MouseEvent<HTMLElement>) => void
    onMouseDown?: (event: React.MouseEvent<HTMLElement>) => void
    onMouseEnter?: (event: React.MouseEvent<HTMLElement>) => void
    onMouseLeave?: (event: React.MouseEvent<HTMLElement>) => void
    onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void
    onFocus?: (event: React.FocusEvent<HTMLElement>) => void
    /** @deprecated Links should never be quietly disabled. Use `disabledReason` to provide an explanation instead. */
    disabled?: boolean
    /** Like plain `disabled`, except we enforce a reason to be shown in the tooltip. */
    disabledReason?: string | null | false
    /**
     * Whether an "open in new" icon should be shown if target is `_blank`.
     * This is true by default if `children` is a string.
     */
    targetBlankIcon?: boolean
    /** If true, the default color will be as normal text with only a link color on hover */
    subtle?: boolean

    /**
     * Accessibility role of the link.
     */
    role?: string

    /**
     * Accessibility tab index of the link.
     */
    tabIndex?: number

    /**
     * Button props to pass to the button primitive.
     * If provided, the link will be rendered as the "new" button primitive.
     */
    buttonProps?: Omit<ButtonPrimitiveProps, 'tooltip' | 'tooltipDocLink' | 'tooltipPlacement' | 'children'>

    tooltip?: TooltipProps['title']
    tooltipDocLink?: TooltipProps['docLink']
    tooltipPlacement?: TooltipProps['placement']
}

const shouldForcePageLoad = (input: any): boolean => {
    if (!input || typeof input !== 'string') {
        return false
    }

    // If the link is to a different team, force a page load to ensure the proper team switch happens
    const matches = input.match(/\/project\/(\d+)/)

    return !!matches && matches[1] !== `${getCurrentTeamId()}`
}

const isPostHogDomain = (url: string): boolean => {
    return /^https:\/\/((www|app|eu)\.)?posthog\.com/.test(url)
}

const isDirectLink = (url: string): boolean => {
    return /^(mailto:|https?:\/\/|:\/\/)/.test(url)
}

const isPostHogComDocs = (url: string): url is PostHogComDocsURL => {
    return /^https:\/\/(www\.)?posthog\.com\/docs/.test(url)
}

export type PostHogComDocsURL = `https://${'www.' | ''}posthog.com/docs/${string}`

/**
 * Link
 *
 * This component wraps an <a> element to ensure that proper tags are added related to target="_blank"
 * as well deciding when a given "to" link should be opened as a standard navigation (i.e. a standard href)
 * or whether to be routed internally via kea-router
 */
export const Link: React.FC<LinkProps & React.RefAttributes<HTMLElement>> = React.forwardRef(
    (
        {
            to,
            target,
            subtle,
            disableClientSideRouting,
            disableDocsPanel = false,
            preventClick = false,
            onClick: onClickRaw,
            className,
            children,
            disabled,
            disabledReason,
            targetBlankIcon = typeof children === 'string',
            buttonProps,
            tooltip,
            tooltipDocLink,
            tooltipPlacement,
            role,
            tabIndex,
            ...props
        },
        ref
    ) => {
        const withinSidePanel = useContext(WithinSidePanelContext)
        const { elementProps: draggableProps } = useNotebookDrag({
            href: typeof to === 'string' ? to : undefined,
        })

        if (withinSidePanel && target === '_blank' && !isExternalLink(to)) {
            target = undefined // Within side panels, treat target="_blank" as "open in main scene"
        }

        const shouldOpenInDocsPanel = !disableDocsPanel && typeof to === 'string' && isPostHogComDocs(to)

        const onClick = (event: React.MouseEvent<HTMLElement>): void => {
            if (event.metaKey || event.ctrlKey) {
                event.stopPropagation()
                return
            }

            onClickRaw?.(event)

            if (event.isDefaultPrevented()) {
                event.preventDefault()
                return
            }

            const mountedSidePanelLogic = sidePanelStateLogic.findMounted()

            if (shouldOpenInDocsPanel && mountedSidePanelLogic) {
                // TRICKY: We do this instead of hooks as there is some weird cyclic issue in tests
                const { sidePanelOpen } = mountedSidePanelLogic.values
                const { openSidePanel } = mountedSidePanelLogic.actions

                event.preventDefault()

                const target = event.currentTarget
                const container = document.getElementsByTagName('main')[0]
                const topBar = document.getElementsByClassName('TopBar3000')[0]
                if (!sidePanelOpen && container.contains(target)) {
                    setTimeout(() => {
                        // Little delay to allow the rendering of the side panel
                        const y = container.scrollTop + target.getBoundingClientRect().top - topBar.clientHeight
                        container.scrollTo({ top: y })
                    }, 50)
                }

                openSidePanel(SidePanelTab.Docs, to)
                return
            }

            if (!target && to && !isExternalLink(to) && !disableClientSideRouting && !shouldForcePageLoad(to)) {
                event.preventDefault()
                if (to && to !== '#' && !preventClick) {
                    if (Array.isArray(to)) {
                        router.actions.push(...to)
                    } else {
                        router.actions.push(to)
                    }
                }
            }
        }

        const rel = typeof to === 'string' && isPostHogDomain(to) ? 'noopener' : 'noopener noreferrer'
        const href = to
            ? typeof to === 'string'
                ? isDirectLink(to) || disableClientSideRouting
                    ? to
                    : addProjectIdIfMissing(to)
                : '#'
            : undefined

        const elementClasses = buttonProps
            ? buttonPrimitiveVariants(buttonProps)
            : `Link ${subtle ? 'Link--subtle' : ''}`

        let element = (
            // eslint-disable-next-line react/forbid-elements
            <a
                ref={ref as any}
                className={cn(elementClasses, className)}
                onClick={onClick}
                href={href}
                target={target}
                rel={target === '_blank' ? rel : undefined}
                role={role}
                tabIndex={tabIndex}
                {...props}
                {...draggableProps}
            >
                {children}
                {targetBlankIcon &&
                    (shouldOpenInDocsPanel && sidePanelStateLogic.isMounted() ? (
                        <IconOpenSidebar />
                    ) : target === '_blank' ? (
                        <IconExternal className={buttonProps ? 'size-3' : ''} />
                    ) : null)}
            </a>
        )

        if ((tooltip && to) || tooltipDocLink) {
            element = (
                <Tooltip title={tooltip} docLink={tooltipDocLink} placement={tooltipPlacement}>
                    {element}
                </Tooltip>
            )
        }

        if (!to) {
            element = (
                <Tooltip
                    title={disabledReason ? <span className="italic">{disabledReason}</span> : tooltip || undefined}
                    placement={tooltipPlacement}
                >
                    <span>
                        <button
                            ref={ref as any}
                            className={cn(elementClasses, className)}
                            onClick={onClick}
                            type="button"
                            disabled={disabled || !!disabledReason}
                            {...props}
                        >
                            {children}
                        </button>
                    </span>
                </Tooltip>
            )
        }

        return element
    }
)
Link.displayName = 'Link'
