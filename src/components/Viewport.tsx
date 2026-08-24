import * as Phaser from 'phaser'
import * as React from 'react'
import { useEffect, useRef } from 'react'
import { SceneNames } from '../../enum';
import LoadingScene from './scenes/LoadingScene';
import IntroScene from './scenes/IntroScene';
import MapScene from './scenes/MapScene';

const columnTop = require('../assets/img/column-top.png')
const columnMid = require('../assets/img/column-mid.png')
const columnBottom = require('../assets/img/column-bottom.png')
const base = require('../assets/img/base.png')
const baseLeft = require('../assets/img/base-l.png')
const ceiling = require('../assets/img/ceiling.png')
const ceilingLeft = require('../assets/img/ceiling-l.png')
const decal = require('../assets/img/decal1-1.png')
const decal2 = require('../assets/img/decal2.png')
const COLUMN_TILE_PX = 32
const COLUMN_RENDER_PX = COLUMN_TILE_PX * 2

const ColumnBorder = ({ side }: { side: 'left' | 'right' }) => (
    <div style={{
        position: 'absolute', top: COLUMN_RENDER_PX, bottom: COLUMN_RENDER_PX, [side]: 0, width: COLUMN_RENDER_PX, zIndex: 10,
        backgroundImage: `url(${columnTop}), url(${columnBottom}), url(${columnMid})`,
        backgroundRepeat: 'no-repeat, no-repeat, repeat-y',
        backgroundPosition: 'top, bottom, top',
        backgroundSize: `${COLUMN_RENDER_PX}px ${COLUMN_RENDER_PX}px`,
        imageRendering: 'pixelated',
        pointerEvents: 'none',
    }} />
)

// Ground strip along the viewport's bottom edge, mirroring Ceiling's own left/right split — base-l.png
// tiling the left half and the plain base texture tiling the right, at the same render scale as
// everything else here.
const Base = () => (
    <>
        <div style={{
            position: 'absolute', left: 0, width: '50%', bottom: 0, height: COLUMN_RENDER_PX, zIndex: 10,
            backgroundImage: `url(${baseLeft})`,
            backgroundRepeat: 'repeat-x',
            backgroundPosition: 'bottom',
            backgroundSize: `${COLUMN_RENDER_PX}px ${COLUMN_RENDER_PX}px`,
            imageRendering: 'pixelated',
            pointerEvents: 'none',
        }} />
        <div style={{
            position: 'absolute', right: 0, width: '50%', bottom: 0, height: COLUMN_RENDER_PX, zIndex: 10,
            backgroundImage: `url(${base})`,
            backgroundRepeat: 'repeat-x',
            backgroundPosition: 'bottom',
            backgroundSize: `${COLUMN_RENDER_PX}px ${COLUMN_RENDER_PX}px`,
            imageRendering: 'pixelated',
            pointerEvents: 'none',
        }} />
    </>
)

// Same as Base but along the top edge, resting on the columns rather than the other way around — split
// straight down the middle, ceiling-l.png tiling the left half and the plain ceiling texture tiling the
// right, each independently at the same render scale as everything else here.
const Ceiling = () => (
    <>
        <div style={{
            position: 'absolute', left: 0, width: '50%', top: 0, height: COLUMN_RENDER_PX, zIndex: 10,
            backgroundImage: `url(${ceilingLeft})`,
            backgroundRepeat: 'repeat-x',
            backgroundPosition: 'top',
            backgroundSize: `${COLUMN_RENDER_PX}px ${COLUMN_RENDER_PX}px`,
            imageRendering: 'pixelated',
            pointerEvents: 'none',
        }} />
        <div style={{
            position: 'absolute', right: 0, width: '50%', top: 0, height: COLUMN_RENDER_PX, zIndex: 10,
            backgroundImage: `url(${ceiling})`,
            backgroundRepeat: 'repeat-x',
            backgroundPosition: 'top',
            backgroundSize: `${COLUMN_RENDER_PX}px ${COLUMN_RENDER_PX}px`,
            imageRendering: 'pixelated',
            pointerEvents: 'none',
        }} />
    </>
)

export default () => {
    const containerRef = useRef(null)
    const componentDidMount = () => {
        new Phaser.Game({
            type: Phaser.AUTO,
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
            parent: 'canvasEl',
            physics: {
                default: 'arcade',
                arcade: {
                    debug: false,
                }
            },
            render: {
                pixelArt: true
            },
            scene: [
                new LoadingScene({key: SceneNames.Loading}),
                new IntroScene({key: SceneNames.Intro}),
                new MapScene({key: SceneNames.Main})
            ]
        })
    }
    React.useEffect(componentDidMount, [])

    return (
        <div style={{ position:'relative', width:'100vw', height:'100vh' }}>
            <div ref={containerRef} id='canvasEl' style={{width:'100vw', height:'100vh'}}/>
            <ColumnBorder side='left' />
            <ColumnBorder side='right' />
            <Base />
            <Ceiling />
            <div style={{pointerEvents:'none', position:'absolute', backgroundSize:'contain', bottom:0, left:-100, zIndex:12, backgroundImage:'url('+decal+')', width:'348px', height:'456px'}}/>
            <div style={{pointerEvents:'none', position:'absolute', backgroundSize:'contain', bottom:-55, right:-50, zIndex:12, backgroundImage:'url('+decal2+')', width:'282px', height:'356px'}}/>
        </div>
    )
}



