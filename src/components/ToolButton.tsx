import * as React from 'react'
import { GREEN } from '../common/Constants'

// The game's one button look — transparent/green-bordered, filled green when active — used by every
// HUD panel (FactoryToolbar, NewGame, ...) so the style only has to be defined once.
export const toolButtonStyle = (active:boolean, disabled?:boolean):React.CSSProperties => ({
    padding: '8px 14px',
    marginRight: '8px',
    background: active ? GREEN : 'black',
    color: active ? '#000' : GREEN,
    border: '2px solid '+GREEN,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    fontFamily: 'Body',
    fontSize: '14px',
    userSelect: 'none',
})

interface ToolButtonProps {
    active?: boolean
    disabled?: boolean
    onClick?: () => void
    children: React.ReactNode
}

export default ({ active, disabled, onClick, children }:ToolButtonProps) =>
    <div style={toolButtonStyle(!!active, disabled)} onClick={disabled ? undefined : onClick}>{children}</div>
