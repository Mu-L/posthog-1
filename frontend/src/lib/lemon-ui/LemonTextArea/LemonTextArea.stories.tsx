import { Meta, StoryFn, StoryObj } from '@storybook/react'
import { LemonTextAreaMarkdown as _LemonTextMarkdown } from 'lib/lemon-ui/LemonTextArea/LemonTextAreaMarkdown'
import { useState } from 'react'

import { LemonTextArea, LemonTextAreaProps } from './LemonTextArea'

type Story = StoryObj<typeof LemonTextArea>
const meta: Meta<typeof LemonTextArea> = {
    title: 'Lemon UI/Lemon Text Area',
    component: LemonTextArea,
    args: {
        value: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    },
    tags: ['autodocs'],
}
export default meta

const Template: StoryFn<typeof LemonTextArea> = (props: LemonTextAreaProps) => {
    const [value, setValue] = useState(props.value)
    return <LemonTextArea {...props} value={value} onChange={(newValue) => setValue(newValue)} />
}

export const Basic: Story = Template.bind({})
Basic.args = {}

export const Disabled: Story = Template.bind({})
Disabled.args = { disabled: true }

export const WithMaxLength: Story = Template.bind({})
WithMaxLength.args = { maxLength: 100, value: '1234567890' }

export const WithMaxLengthExceeded: Story = Template.bind({})
WithMaxLengthExceeded.args = { maxLength: 5, value: '1234567890' }

export const WithFooter: Story = Template.bind({})
WithFooter.args = { footer: <div className="text-xs">I am a custom footer</div> }

export const WithFooterAndMaxLength: Story = Template.bind({})
WithFooterAndMaxLength.args = {
    footer: <div className="text-xs">I am a custom footer</div>,
    maxLength: 5,
    value: '1234567890',
}

export const EmptyLemonTextMarkdown = (): JSX.Element => {
    const [value, setValue] = useState('')
    return <_LemonTextMarkdown value={value} onChange={(newValue) => setValue(newValue)} />
}

export const LemonTextMarkdownWithText = (): JSX.Element => {
    const [value, setValue] = useState('# Title\n\n**bold** _italic_')
    return <_LemonTextMarkdown value={value} onChange={(newValue) => setValue(newValue)} />
}

export const LemonTextMarkdownWithMaxLength = (): JSX.Element => {
    const [value, setValue] = useState('# Title\n\n**bold** _italic_')
    return <_LemonTextMarkdown value={value} onChange={(newValue) => setValue(newValue)} maxLength={12} />
}

export const LemonTextMarkdownWithFooter = (): JSX.Element => {
    const [value, setValue] = useState('# Title\n\n**bold** _italic_')
    return (
        <_LemonTextMarkdown
            value={value}
            onChange={(newValue) => setValue(newValue)}
            footer={<div className="text-xs">I am a custom footer</div>}
        />
    )
}

export const LemonTextMarkdownWithMaxLengthAndFooter = (): JSX.Element => {
    const [value, setValue] = useState('# Title\n\n**bold** _italic_')
    return (
        <_LemonTextMarkdown
            value={value}
            onChange={(newValue) => setValue(newValue)}
            maxLength={12}
            footer={<div className="text-xs">I am a custom footer</div>}
        />
    )
}
