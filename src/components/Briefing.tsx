import * as React from 'react'
import { onShowModal } from '../common/Thunks';
import { SceneNames, SoundEffects } from '../../enum';
import { useAppStore } from '../common/store';
import ToolButton from './ToolButton'
import { colors } from '../styles/AppStyles';

const FADE_IN_MS = 800
const FADE_OUT_MS = 800
const SCROLL_DURATION_MS = 9000
const TYPEWRITER_CHARS_PER_SEC = 45

const LOREM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`

// Shown once, right after NewGame's "New" button, before MapScene actually starts (see its own
// startNewGame, which sets activeMapKey to the map this hands off to and shows this instead of starting
// the scene directly). Scrolls the briefing text once in Phase1, then hands off to a typewriter reveal
// of the same text in Body (ATC) — Skip jumps straight to the fully-revealed end state and, same as
// letting the scroll finish on its own, turns the button into Start, which fades this out and only then
// actually starts MapScene.
export default () => {
    const [mounted, setMounted] = React.useState(false)
    const [fadingOut, setFadingOut] = React.useState(false)
    const [scrollComplete, setScrollComplete] = React.useState(false)
    const [typedLength, setTypedLength] = React.useState(0)

    React.useEffect(() => {
        const frame = requestAnimationFrame(() => setMounted(true))
        return () => cancelAnimationFrame(frame)
    }, [])

    // Plays for the duration of the briefing sequence; MapScene.create stops it and starts main.mp3
    // once the map has actually loaded. Also stopped here on unmount as a safety net in case the
    // sequence is torn down without ever reaching that point.
    React.useEffect(() => {
        const sound = useAppStore.getState().scene?.sound.get(SoundEffects.Briefing)
        sound?.play(undefined, { loop: true, volume: useAppStore.getState().playerSettings.volume })
        return () => { sound?.stop() }
    }, [])

    React.useEffect(() => {
        if(scrollComplete) return
        const timeout = setTimeout(() => setScrollComplete(true), SCROLL_DURATION_MS)
        return () => clearTimeout(timeout)
    }, [scrollComplete])

    React.useEffect(() => {
        if(!scrollComplete || typedLength >= LOREM.length) return
        const interval = setInterval(() => setTypedLength(l => Math.min(LOREM.length, l+1)), 1000/TYPEWRITER_CHARS_PER_SEC)
        return () => clearInterval(interval)
    }, [scrollComplete, typedLength])

    React.useEffect(() => {
        if(!fadingOut) return
        const timeout = setTimeout(() => {
            onShowModal(null)
            useAppStore.getState().scene?.scene.start(SceneNames.Main)
        }, FADE_OUT_MS)
        return () => clearTimeout(timeout)
    }, [fadingOut])

    const handleSkipOrStart = () => {
        if(!scrollComplete){
            setScrollComplete(true)
            setTypedLength(LOREM.length)
            return
        }
        setFadingOut(true)
    }

    return (
        <div style={{
            position:'fixed', inset:0, zIndex:5, background:colors.black,
            display:'flex', alignItems:'center', justifyContent:'center',
            opacity: fadingOut ? 0 : (mounted ? 1 : 0),
            transition: `opacity ${(fadingOut ? FADE_OUT_MS : FADE_IN_MS)}ms ease`,
        }}>
            <div style={{ width:'80%', maxWidth:1100, height:'65%', display:'flex' }}>
                <div style={{ width:'60%', position:'relative', overflow:'hidden' }}>
                    {/* One and the same block throughout — it scrolls up to a resting position in
                        Phase1, then transforms into the ATC typewriter reveal right there in place,
                        rather than swapping to a separately-positioned element. */}
                    <div style={{
                        position:'absolute', left:0, right:0,
                        fontFamily: scrollComplete ? 'Body' : 'Phase1',
                        color:colors.green, fontSize:20, lineHeight:1.6, whiteSpace:'pre-wrap',
                        transform: mounted ? 'translateY(0%)' : 'translateY(110%)',
                        transition: scrollComplete ? undefined : `transform ${SCROLL_DURATION_MS}ms linear`,
                    }}>{scrollComplete ? LOREM.slice(0, typedLength) : LOREM}</div>
                </div>

                <div style={{ width:'10%' }}/>

                <div style={{
                    width:'30%', border:`2px dashed ${colors.green}`, opacity:0.6,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    color:colors.green, fontFamily:'Body', fontSize:14,
                }}>IMAGE</div>
            </div>

            <div style={{ position:'absolute', bottom:40, right:60 }}>
                <ToolButton onClick={handleSkipOrStart}>{scrollComplete ? 'Start' : 'Skip'}</ToolButton>
            </div>
        </div>
    )
}
