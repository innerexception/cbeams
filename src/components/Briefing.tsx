import * as React from 'react'
import { onShowModal } from '../common/Thunks';
import { SceneNames, SoundEffects } from '../../enum';
import { useAppStore } from '../common/store';
import { colors, MODAL_PADDING_PX } from '../styles/AppStyles';
import { MAP_METADATA } from '../assets/MapMetadata';

const stars = require('../assets/img/stars.png')

const FADE_IN_MS = 800
const FADE_OUT_MS = 800
const TYPEWRITER_CHARS_PER_SEC = 45
// Total time for the image panel to pan through every one of its map's own imageKeyframes, start to
// finish — split evenly across however many keyframe-to-keyframe legs that map happens to have.
const IMAGE_ANIMATION_DURATION_MS = 3000

type Phase = 'phase1' | 'atc'

// Shown once, right after NewGame's "New" button, before MapScene actually starts (see its own
// startNewGame, which sets activeMapKey to the map this hands off to and shows this instead of starting
// the scene directly). Each sentence is typed out once in Phase1, then immediately retyped in place over
// itself in Body (ATC) — same text, each letter overwritten one at a time from Phase1 into ATC — before
// the sequence moves on to the next sentence. A click anywhere, while it's still typing, jumps straight
// to every sentence fully in its ATC form; the next click after that (same handler, sequenceComplete now
// true) fades this out and only then actually starts MapScene.
export default () => {
    const [mounted, setMounted] = React.useState(false)
    const [fadingOut, setFadingOut] = React.useState(false)
    const [sentenceIndex, setSentenceIndex] = React.useState(0)
    const [phase, setPhase] = React.useState<Phase>('phase1')
    const [charIndex, setCharIndex] = React.useState(0)

    const activeMapKey = useAppStore(state => state.activeMapKey)
    const briefingText = MAP_METADATA[activeMapKey]?.briefingText ?? ''
    // Split on sentence-ending punctuation, each entry keeping its own terminator and any whitespace up
    // to the next sentence (so joining them all back together reproduces briefingText exactly, paragraph
    // breaks included) — this is what lets the sequence below advance one whole sentence at a time.
    const sentences = React.useMemo(() => briefingText.match(/[^.!?]+[.!?]*\s*/g) ?? [briefingText], [briefingText])

    const sequenceComplete = sentenceIndex >= sentences.length
    const imageKeyframes = MAP_METADATA[activeMapKey]?.imageKeyframes ?? []
    const [keyframeIndex, setKeyframeIndex] = React.useState(0)
    // Even split of the fixed total duration across however many keyframe-to-keyframe legs there are —
    // e.g. 2 keyframes is a single 3000ms leg, 3 is two 1500ms legs.
    const keyframeLegMs = imageKeyframes.length > 1 ? IMAGE_ANIMATION_DURATION_MS / (imageKeyframes.length-1) : 0

    // Steps keyframeIndex forward one at a time; the actual pan between each pair happens via the CSS
    // transition on backgroundPosition below, not by animating this index itself. Stops (and stays put)
    // once it reaches the last keyframe — a one-shot pan through the whole sequence, not a loop.
    React.useEffect(() => {
        if(keyframeIndex >= imageKeyframes.length-1) return
        const timeout = setTimeout(() => setKeyframeIndex(i => i+1), keyframeLegMs)
        return () => clearTimeout(timeout)
    }, [keyframeIndex, imageKeyframes.length, keyframeLegMs])

    // Flips true once the pan has actually finished moving — not the instant keyframeIndex reaches the
    // last keyframe (that's when its CSS transition *starts*, still keyframeLegMs away from done), but
    // keyframeLegMs after that. Without this extra wait the zoom's own transform transition would start
    // in parallel with the still-in-flight backgroundPosition one instead of after it.
    const [panFinished, setPanFinished] = React.useState(imageKeyframes.length <= 1)
    React.useEffect(() => {
        if(keyframeIndex < imageKeyframes.length-1) return
        const timeout = setTimeout(() => setPanFinished(true), keyframeLegMs)
        return () => clearTimeout(timeout)
    }, [keyframeIndex, imageKeyframes.length, keyframeLegMs])

    React.useEffect(() => {
        const frame = requestAnimationFrame(() => setMounted(true))
        return () => cancelAnimationFrame(frame)
    }, [])

    // Plays for the duration of the briefing sequence; MapScene.create stops it and starts main.mp3
    // once the map has actually loaded. Also stopped here on unmount as a safety net in case the
    // sequence is torn down without ever reaching that point.
    React.useEffect(() => {
        const sound = useAppStore.getState().scene?.sound.get(SoundEffects.Briefing)
        sound?.play(undefined, { loop: true, volume: useAppStore.getState().playerSettings.musicVolume })
        return () => { sound?.stop() }
    }, [])

    // Drives charIndex up through the current sentence for whichever phase is active. Once it reaches
    // the sentence's end, Phase1 hands off to ATC over the very same sentence (restarting charIndex so
    // the overwrite pass runs letter-by-letter too), and ATC finishing hands off to Phase1 on the next
    // sentence — until there isn't one, at which point the sequence is complete.
    React.useEffect(() => {
        if(sequenceComplete) return
        const sentence = sentences[sentenceIndex]
        if(charIndex >= sentence.length){
            if(phase === 'phase1'){
                setPhase('atc')
                setCharIndex(0)
            }
            else {
                setSentenceIndex(i => i+1)
                setPhase('phase1')
                setCharIndex(0)
            }
            return
        }
        const interval = setInterval(() => setCharIndex(c => c+1), 1000/TYPEWRITER_CHARS_PER_SEC)
        return () => clearInterval(interval)
    }, [sequenceComplete, sentenceIndex, phase, charIndex])

    React.useEffect(() => {
        if(!fadingOut) return
        const timeout = setTimeout(() => {
            onShowModal(null)
            useAppStore.getState().scene?.scene.start(SceneNames.Main)
        }, FADE_OUT_MS)
        return () => clearTimeout(timeout)
    }, [fadingOut])

    const handleClick = () => {
        if(!sequenceComplete){
            setSentenceIndex(sentences.length)
            setPhase('phase1')
            setCharIndex(0)
            return
        }
        setFadingOut(true)
    }

    return (
        <div onClick={handleClick} style={{
            position:'fixed', inset:0, zIndex:5, background:colors.black, padding:MODAL_PADDING_PX,
            display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column',
            opacity: fadingOut ? 0 : (mounted ? 1 : 0),
            transition: `opacity ${(fadingOut ? FADE_OUT_MS : FADE_IN_MS)}ms ease`,
            cursor:'pointer',
        }}>
            <div style={{ width:'80%', maxWidth:1100, height:'65%', display:'flex' }}>
                <div style={{ width:'60%', position:'relative', overflow:'hidden' }}>
                    {/* Every already-finished sentence sits fully in its ATC (Body) form. The sentence
                        currently in play is either being typed fresh in Phase1, or — once that's done —
                        being overwritten in place: the same characters, just split at charIndex between
                        the ATC span already retyped and the Phase1 span still waiting its turn. */}
                    <div style={{
                        position:'absolute', left:0, right:0,
                        color:colors.green, fontSize:20, lineHeight:1.6, whiteSpace:'pre-wrap',
                    }}>
                        {sentences.slice(0, sentenceIndex).map((sentence, i) =>
                            <span key={i} style={{ fontFamily:'Body' }}>{sentence}</span>
                        )}
                        {!sequenceComplete && phase === 'phase1' &&
                            <span style={{ fontFamily:'Phase1' }}>{sentences[sentenceIndex].slice(0, charIndex)}</span>
                        }
                        {!sequenceComplete && phase === 'atc' && <>
                            <span style={{ fontFamily:'Body' }}>{sentences[sentenceIndex].slice(0, charIndex)}</span>
                            <span style={{ fontFamily:'Phase1' }}>{sentences[sentenceIndex].slice(charIndex)}</span>
                        </>}
                    </div>
                </div>

                <div style={{ width:'10%' }}/>

                {/* The frame itself (border/sizing) never transforms — only the map div inside it zooms,
                    clipped to the frame's own bounds by this div's overflow:hidden, so the zoom reads as
                    the map growing within a fixed window rather than the whole frame growing too. */}
                <div style={{
                    width:'30%', border:`2px dashed ${colors.green}`, opacity:0.6, overflow:'hidden',
                    position:'relative', color:colors.green, fontFamily:'Body', fontSize:14,
                }}>
                    <div style={{
                        position:'absolute', inset:0, backgroundImage:'url('+stars+')',
                        backgroundPosition: imageKeyframes[keyframeIndex] ? `${imageKeyframes[keyframeIndex].x}px ${imageKeyframes[keyframeIndex].y}px` : undefined,
                        transform: panFinished ? 'scale(1.5)' : 'scale(1)',
                        transition: [keyframeLegMs && `background-position ${keyframeLegMs}ms linear`, 'transform 500ms ease']
                            .filter(Boolean).join(', '),
                    }}/>
                </div>
            </div>
        </div>
    )
}
