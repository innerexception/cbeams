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
const COLUMN_TILE_PX = 32
const COLUMN_RENDER_PX = COLUMN_TILE_PX * 2

// A decorative frame along the viewport's left/right edges: column-top/column-bottom cap the very top
// and bottom (one render-scale tile), column-mid tiles to fill whatever's left between them. Drawn as
// three stacked backgrounds (top and bottom listed first so they paint over the tiled mid layer at
// their own ends) rather than three separate elements, so there's no need to measure anything to know
// how much of the middle tile to show. Rendered at double the source art's native 32px so each tile
// scales up as a whole square (backgroundSize covers both axes) rather than just tiling twice as often.
// Inset by one render-scale tile on both ends — top and bottom — so it sits between (supporting, not
// overlapping) the Ceiling strip above and the Base strip below.
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
            type: Phaser.WEBGL,
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
        </div>
    )
}



